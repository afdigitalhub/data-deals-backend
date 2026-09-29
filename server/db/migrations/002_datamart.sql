-- Add DataMart GH as an automatic supplier. Starts DISABLED: an owner enables it in Admin → Suppliers
-- after the connection test passes. Non-destructive: nothing existing is changed.
INSERT INTO suppliers (code, name, adapter, is_enabled, networks, notes)
VALUES ('datamart', 'DataMart GH', 'datamart', false, ARRAY['MTN','TELECEL','AT'],
        'Data bundles via the DataMart GH API. Supplier product code = bundle size in GB (e.g. 1, 2, 5). Needs DATAMART_API_KEY in Render.')
ON CONFLICT (code) DO NOTHING;
