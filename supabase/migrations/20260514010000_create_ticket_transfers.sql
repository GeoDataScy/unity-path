-- Ticket transfer requests between agents.
-- A row represents one "please continue this ticket" handoff request.
-- The ticket itself stays with the original owner (to_user_id == the owner being asked).

CREATE TABLE public.ticket_transfers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id        text NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  from_user_id      text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user_id        text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','declined','cancelled')),
  message           text,
  response_note     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  responded_at      timestamptz,
  recipient_seen_at timestamptz,
  requester_seen_at timestamptz,
  CONSTRAINT ticket_transfers_distinct_parties CHECK (from_user_id <> to_user_id)
);

CREATE INDEX idx_ticket_transfers_to_user
  ON public.ticket_transfers(to_user_id, status);
CREATE INDEX idx_ticket_transfers_from_user
  ON public.ticket_transfers(from_user_id, status);
CREATE INDEX idx_ticket_transfers_service
  ON public.ticket_transfers(service_id);

-- Prevents the same agent from creating two pending requests for the same ticket.
CREATE UNIQUE INDEX idx_unique_pending_transfer
  ON public.ticket_transfers(service_id, from_user_id)
  WHERE status = 'pending';

ALTER TABLE public.ticket_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents see own transfers"
  ON public.ticket_transfers
  FOR SELECT
  USING (from_user_id = auth.uid()::text OR to_user_id = auth.uid()::text);

CREATE POLICY "Managers see all transfers"
  ON public.ticket_transfers
  FOR SELECT
  USING (public.is_manager());

CREATE POLICY "Agents create transfers as sender"
  ON public.ticket_transfers
  FOR INSERT
  WITH CHECK (from_user_id = auth.uid()::text);

CREATE POLICY "Agents update own transfers"
  ON public.ticket_transfers
  FOR UPDATE
  USING (from_user_id = auth.uid()::text OR to_user_id = auth.uid()::text)
  WITH CHECK (from_user_id = auth.uid()::text OR to_user_id = auth.uid()::text);

GRANT SELECT, INSERT, UPDATE ON public.ticket_transfers TO authenticated;

NOTIFY pgrst, 'reload schema';
