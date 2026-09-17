-- =========================================================
-- TRAMA — Configuração inicial do Supabase
-- Cole este script inteiro no SQL Editor do seu projeto Supabase
-- e clique em "Run". Ele cria:
--   1. A tabela de perfis (com o papel: cliente ou gerente)
--   2. A tabela de produtos
--   3. As regras de permissão (Row Level Security)
-- =========================================================

-- ---------- 1. Perfis ----------
-- Guarda o "papel" de cada pessoa (user = cliente, manager = gerente).
-- O Supabase já cuida de e-mail/senha na tabela auth.users; esta tabela
-- é só um complemento nosso, ligada a ela.
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  role text not null default 'user' check (role in ('user', 'manager')),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Cada pessoa vê o próprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

-- Cria automaticamente um perfil (papel "user" por padrão) sempre que
-- alguém se cadastra pelo site.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- 2. Produtos ----------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  price numeric(10,2) not null,
  tag text,
  image_url text,
  created_at timestamptz default now()
);

alter table public.products enable row level security;

-- Qualquer visitante (mesmo sem login) pode VER os produtos.
create policy "Todo mundo pode ver os produtos"
  on public.products for select
  using (true);

-- Só quem tem role = 'manager' no perfil pode inserir, editar ou remover.
create policy "Só gerentes podem adicionar produtos"
  on public.products for insert
  with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'manager')
  );

create policy "Só gerentes podem editar produtos"
  on public.products for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'manager')
  );

create policy "Só gerentes podem remover produtos"
  on public.products for delete
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'manager')
  );

-- ---------- 3. Catálogo inicial (opcional) ----------
-- Já deixa os mesmos 6 produtos de exemplo cadastrados, para não começar do zero.
insert into public.products (name, category, price, tag) values
  ('Camisa Alfaiataria Linho', 'camisa', 289.00, 'Novo'),
  ('Calça Reta Sarja', 'calca', 349.00, 'Best-seller'),
  ('Casaco Lã Trama Dupla', 'casaco', 649.00, 'Edição limitada'),
  ('Vestido Corte Reto', 'vestido', 419.00, 'Novo'),
  ('Camiseta Algodão Pima', 'camisa', 149.00, null),
  ('Blazer Estruturado', 'casaco', 589.00, 'Best-seller');

-- ---------- 4. Permissão de upload de imagens (rode depois de criar o bucket "product-images") ----------
create policy "Só gerentes podem enviar imagens de produto"
  on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'manager')
  );

create policy "Só gerentes podem remover imagens de produto"
  on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'manager')
  );

-- ---------- 5. Nome de exibição no perfil (rode se você já criou o projeto antes disso) ----------
alter table public.profiles add column if not exists name text;

-- Atualiza a função para também gravar o nome informado no cadastro (novas contas)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, new.raw_user_meta_data->>'name');
  return new;
end;
$$ language plpgsql security definer;

-- Preenche o nome de quem já tinha se cadastrado antes dessa coluna existir.
-- Troque o e-mail e o nome abaixo pelos seus (rode uma linha dessas para cada conta já criada):
-- update public.profiles set name = 'Seu Nome' where email = 'seu-email@exemplo.com';
