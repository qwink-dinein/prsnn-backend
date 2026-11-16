-- Indexes for two foreign keys the performance advisor flagged (admin tables). Applied.
create index if not exists broadcasts_sent_by on public.broadcasts (sent_by);
create index if not exists settings_updated_by on public.settings (updated_by);
