-- Local bootstrap, to run once after the migrations and after a first sign-in
-- (the user row must exist). Idempotent: re-running changes nothing.
-- Replace the e-mail below with the address used to sign in.
with me as (select id from "user" where email = 'vous@exemple.com')
insert into role_assignment (user_id, role)
select id, 'admin' from me
on conflict do nothing;

insert into product (id, name) values
  ('insight', 'Trigenys Insight'),
  ('precis', 'Précis Translator'),
  ('atelier', 'Atelier Maître')
on conflict (id) do nothing;
