-- Admin policies for refund_requests (table created in 00500)
CREATE POLICY "Admins can manage refund_requests"
  ON refund_requests FOR ALL
  TO authenticated
  USING (is_admin_user())
  WITH CHECK (is_admin_user());
