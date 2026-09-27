const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_KEY = process.env.ADMIN_API_KEY || 'changeme';
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';

function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function genReferralCode() {
  return 'AG' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

app.get('/', (req, res) => res.json({ status: 'Data Deals API running' }));

app.get('/api/services', async (req, res) => {
  try {
    const { category, network } = req.query;
    let query = 'SELECT * FROM services WHERE active = true';
    const params = [];
    if (category) { params.push(category); query += ` AND category = $${params.length}`; }
    if (network) { params.push(network); query += ` AND network = $${params.length}`; }
    query += ' ORDER BY category, network, price';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });
    const code = genReferralCode();
    const result = await pool.query(
      'INSERT INTO agents (name, phone, referral_code) VALUES ($1, $2, $3) RETURNING *',
      [name, phone, code]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create agent (phone may already be registered)' });
  }
});

app.get('/api/agents/:code', async (req, res) => {
  try {
    const agentResult = await pool.query('SELECT * FROM agents WHERE referral_code = $1', [req.params.code]);
    if (agentResult.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });
    const agent = agentResult.rows[0];
    const salesResult = await pool.query(
      "SELECT COUNT(*) as total_sales, COALESCE(SUM(commission_amount),0) as total_commission FROM orders WHERE agent_id = $1 AND status = 'paid'",
      [agent.id]
    );
    res.json({ ...agent, ...salesResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customer_phone, service_id, recipient_phone, referral_code } = req.body;
    if (!customer_phone || !service_id || !recipient_phone) {
      return res.status(400).json({ error: 'customer_phone, service_id, recipient_phone required' });
    }

    let customer = await pool.query('SELECT * FROM customers WHERE phone = $1', [customer_phone]);
    if (customer.rows.length === 0) {
      customer = await pool.query('INSERT INTO customers (phone) VALUES ($1) RETURNING *', [customer_phone]);
    }
    const customerId = customer.rows[0].id;

    const service = await pool.query('SELECT * FROM services WHERE id = $1 AND active = true', [service_id]);
    if (service.rows.length === 0) return res.status(404).json({ error: 'Service not found' });
    const price = service.rows[0].price;

    let agentId = null;
    let commission = 0;
    if (referral_code) {
      const agent = await pool.query('SELECT * FROM agents WHERE referral_code = $1', [referral_code]);
      if (agent.rows.length > 0) {
        agentId = agent.rows[0].id;
        commission = Math.round(price * 0.10 * 100) / 100;
      }
    }

    const reference = 'DD' + Date.now() + Math.floor(Math.random() * 1000);

    const order = await pool.query(
      `INSERT INTO orders (customer_id, service_id, recipient_phone, amount, paystack_reference, agent_id, commission_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [customerId, service_id, recipient_phone, price, reference, agentId, commission]
    );

    res.json({ order: order.rows[0], reference, amount: price });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

app.post('/api/webhook/paystack', express.json({ type: '*/*' }), async (req, res) => {
  try {
    const event = req.body;
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      await pool.query(
        "UPDATE orders SET status = 'paid' WHERE paystack_reference = $1 AND status = 'pending'",
        [reference]
      );

      const order = await pool.query('SELECT * FROM orders WHERE paystack_reference = $1', [reference]);
      if (order.rows.length > 0 && order.rows[0].agent_id) {
        await pool.query(
          'UPDATE agents SET wallet_balance = wallet_balance + $1 WHERE id = $2',
          [order.rows[0].commission_amount, order.rows[0].agent_id]
        );
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get('/api/orders/verify/:reference', async (req, res) => {
  try {
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Paystack not configured yet' });
    const response = await fetch(`https://api.paystack.co/transaction/verify/${req.params.reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    const data = await response.json();
    if (data.data && data.data.status === 'success') {
      await pool.query(
        "UPDATE orders SET status = 'paid' WHERE paystack_reference = $1 AND status = 'pending'",
        [req.params.reference]
      );
    }
    res.json(data.data || { status: 'not_found' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, c.phone as customer_phone, s.name as service_name, s.network
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      JOIN services s ON o.service_id = s.id
      ORDER BY o.created_at DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.post('/api/admin/orders/:id/fulfill', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE orders SET status = 'fulfilled', fulfilled_at = now() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

app.get('/api/admin/agents', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agents ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Data Deals API running on port ${PORT}`));
