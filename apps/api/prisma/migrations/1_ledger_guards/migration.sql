-- Ledger e auditoria são somente-inserção (seções 5.4, 11.7 e 21.6)
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % é somente inserção (UPDATE/DELETE proibidos)', TG_TABLE_NAME;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE ledger_entries ADD CONSTRAINT ledger_one_side CHECK (
  (debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0));

-- Row-Level Security por workspace (defesa em profundidade, seção 11.3).
-- O dono das tabelas (papel de migração) ignora RLS; papéis de aplicação com menos
-- privilégio respeitam as políticas e precisam de SET LOCAL app.workspace_id.
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_isolation ON products USING (workspace_id::text = current_setting('app.workspace_id', true));
CREATE POLICY ws_isolation ON orders USING (workspace_id::text = current_setting('app.workspace_id', true));
CREATE POLICY ws_isolation ON offers USING (workspace_id::text = current_setting('app.workspace_id', true));
CREATE POLICY ws_isolation ON withdrawals USING (workspace_id::text = current_setting('app.workspace_id', true));
