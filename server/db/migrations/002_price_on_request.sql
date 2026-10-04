-- A price of 0 means "ask for price": the item shows on the shop but is ordered by chatting, not through the bag.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_minor_check;
ALTER TABLE products ADD CONSTRAINT products_price_minor_check CHECK (price_minor >= 0);
