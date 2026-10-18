-- Contact numbers are collected for participant engagement follow-up.
-- Run this migration before deploying the required WhatsApp registration field.
alter table public.profiles
  add column if not exists whatsapp_number text;

alter table public.profiles
  add column if not exists whatsapp_consent_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_whatsapp_number_e164_check;

alter table public.profiles
  add constraint profiles_whatsapp_number_e164_check
  check (whatsapp_number is null or whatsapp_number ~ '^[+][1-9][0-9]{7,14}$');
