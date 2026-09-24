/* =========================================================
   TRAMA — script.js
   Sumário:
   0. Tema (claro/escuro)
   0b. Conexão com o Supabase
   1. Catálogo de produtos (agora vem do banco de dados)
   2. Ícones SVG por categoria (usados quando o produto não tem imagem)
   3. Estado do carrinho (persistente via localStorage, local a cada navegador)
   4. Renderização da grade de produtos
   5. Lógica da sacola (cart drawer) e da página de checkout
   6. Menu mobile
   6b. Dropdown de categorias (cabeçalho)
   6c. Página de categoria (categoria.html)
   7. Formulário de newsletter
   8. Autenticação real (Supabase Auth)
   8b. Mostrar/ocultar senha
   9. Página de login/cadastro (login.html)
   10. Backoffice (backoffice.html)
   11. Inicialização
   ========================================================= */

(function () {
  "use strict";

  /* ---------- 0. Tema (claro/escuro) ---------- */
  const THEME_KEY = "trama-theme";

  function applyTheme(theme) {
    if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
  }

  function initTheme() {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;

    let current = "dark";
    try {
      current = localStorage.getItem(THEME_KEY) || "dark";
    } catch (e) {}

    const sync = (theme) => {
      toggle.setAttribute("aria-pressed", String(theme === "light"));
      toggle.setAttribute("aria-label", theme === "light" ? "Alternar para modo escuro" : "Alternar para modo claro");
    };
    sync(current);

    toggle.addEventListener("click", () => {
      current = current === "light" ? "dark" : "light";
      applyTheme(current);
      sync(current);
      try {
        localStorage.setItem(THEME_KEY, current);
      } catch (e) {}
    });
  }

  /* ---------- 0b. Conexão com o Supabase ---------- */
  const SUPABASE_URL = "https://lyjryntwcbygcgienmhd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_LzgZunD2eCJXVPnCtA_ScQ_SvNesU6j";
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  /* ---------- 1. Catálogo de produtos (agora vem do banco de dados) ---------- */
  // Cache local: evita re-consultar o banco toda vez que o carrinho precisa
  // achar os dados de um produto. É atualizado sempre que getProducts() roda.
  let productsCache = [];

  function normalizeProduct(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      price: Number(row.price),
      tag: row.tag || "",
      image: row.image_url || null,
    };
  }

  // Busca todos os produtos no Supabase e atualiza o cache local.
  // Sempre traz a lista inteira (o catálogo é pequeno) — filtros são
  // aplicados depois, em cima do cache, para não bater no banco toda hora.
  async function getProducts() {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Erro ao carregar produtos:", error.message);
      return productsCache;
    }

    productsCache = data.map(normalizeProduct);
    return productsCache;
  }

  /* ---------- 2. Ícones SVG por categoria ---------- */
  const ICONS = {
    camisa: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 8 L10 18 L16 26 L22 22 V56 H42 V22 L48 26 L54 18 L42 8 Q32 14 22 8 Z" stroke-linejoin="round"/></svg>`,
    calca:  `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 6 H46 L48 56 L36 56 L32 26 L28 56 L16 56 Z" stroke-linejoin="round"/></svg>`,
    casaco: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M24 6 L12 14 L8 34 L16 36 L18 24 V58 H46 V24 L48 36 L56 34 L52 14 L40 6 Q32 12 24 6 Z" stroke-linejoin="round"/></svg>`,
    vestido:`<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M24 6 L14 16 L20 24 L24 20 L18 58 H46 L40 20 L44 24 L50 16 L40 6 Q32 12 24 6 Z" stroke-linejoin="round"/></svg>`,
  };

  function productThumb(p) {
    return p.image ? `<img src="${p.image}" alt="${p.name}">` : (ICONS[p.category] || "");
  }

  // O Supabase Storage só aceita letras sem acento, números, ponto, hífen e
  // underline no nome do arquivo. Nomes com "ç", "ã", espaços etc. (comuns em
  // arquivos salvos no Windows) precisam ser "limpos" antes do envio.
  function sanitizeFileName(name) {
    return name
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos (ç, ã, é...)
      .replace(/[^a-zA-Z0-9.\-_]/g, "-")                 // troca o resto por hífen
      .toLowerCase();
  }

  const currency = (value) =>
    value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const CATEGORY_LABELS = {
    "": "Todas as peças",
    camisa: "Camisas",
    casaco: "Casacos e blazers",
    calca: "Calças",
    vestido: "Vestidos",
  };

  function getCategoryFromURL() {
    return new URLSearchParams(window.location.search).get("cat") || "";
  }

  /* ---------- 3. Estado do carrinho (persistente via localStorage, local a cada navegador) ---------- */
  // O carrinho continua só no navegador (não no banco) — ele guarda ids de
  // produtos + quantidade, e busca os dados de cada um no cache de produtos.
  const CART_KEY = "trama-cart";
  let cart = new Map(); // id -> quantidade

  function loadCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) cart = new Map(JSON.parse(raw).map((item) => [item.id, item.qty]));
    } catch (e) {
      cart = new Map();
    }
  }

  function saveCart() {
    try {
      const arr = Array.from(cart.entries()).map(([id, qty]) => ({ id, qty }));
      localStorage.setItem(CART_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  /* ---------- 4. Renderização da grade de produtos ---------- */
  // Usa o que já está em productsCache (populado no início de init()) — não
  // faz uma nova consulta ao banco a cada troca de categoria.
  function renderProducts(filterCategory) {
    const grid = document.getElementById("productGrid");
    const list = filterCategory
      ? productsCache.filter((p) => p.category === filterCategory)
      : productsCache;

    grid.innerHTML = list.length
      ? list.map((p) => `
        <article class="card">
          <div class="card__art">${productThumb(p)}</div>
          <div class="card__info">
            <span class="card__tag">${p.tag || p.category}</span>
            <h3 class="card__name">${p.name}</h3>
            <span class="card__price">${currency(p.price)}</span>
          </div>
          <button class="card__add" data-id="${p.id}">Adicionar à sacola</button>
        </article>
      `).join("")
      : `<p class="cart-empty">Nenhum produto encontrado.</p>`;

    grid.querySelectorAll(".card__add").forEach((btn) => {
      btn.addEventListener("click", () => {
        addToCart(btn.dataset.id);
        btn.dataset.added = "true";
        const original = btn.textContent;
        btn.textContent = "Adicionado ✓";
        setTimeout(() => {
          btn.textContent = original;
          btn.dataset.added = "false";
        }, 1200);
      });
    });
  }

  /* ---------- 5. Lógica da sacola (cart drawer) e da página de checkout ---------- */
  function addToCart(id) {
    const product = productsCache.find((p) => p.id === id);
    if (!product) return;
    cart.set(id, (cart.get(id) || 0) + 1);
    saveCart();
    renderCart();
  }

  function changeQty(id, delta) {
    const qty = cart.get(id);
    if (qty === undefined) return;
    const next = qty + delta;
    if (next <= 0) cart.delete(id);
    else cart.set(id, next);
    saveCart();
    renderCart();
  }

  function removeFromCart(id) {
    cart.delete(id);
    saveCart();
    renderCart();
  }

  function renderCart() {
    const entries = Array.from(cart.entries())
      .map(([id, qty]) => ({ product: productsCache.find((p) => p.id === id), qty }))
      .filter((e) => e.product);

    const totalQty = entries.reduce((sum, e) => sum + e.qty, 0);
    const totalPrice = entries.reduce((sum, e) => sum + e.qty * e.product.price, 0);

    const countEl = document.getElementById("cartCount");
    if (countEl) countEl.textContent = totalQty;

    renderCartDrawer(entries, totalPrice);
    renderCheckoutList(entries, totalPrice);
  }

  function bindQtyControls(container) {
    container.querySelectorAll("[data-id]").forEach((row) => {
      const id = row.dataset.id;
      const plus = row.querySelector(".qty-plus");
      const minus = row.querySelector(".qty-minus");
      const remove = row.querySelector(".cart-item__remove");
      if (plus) plus.addEventListener("click", () => changeQty(id, 1));
      if (minus) minus.addEventListener("click", () => changeQty(id, -1));
      if (remove) remove.addEventListener("click", () => removeFromCart(id));
    });
  }

  function renderCartDrawer(entries, totalPrice) {
    const itemsEl = document.getElementById("cartItems");
    if (!itemsEl) return;
    const totalEl = document.getElementById("cartTotal");
    if (totalEl) totalEl.textContent = currency(totalPrice);

    if (entries.length === 0) {
      itemsEl.innerHTML = `<p class="cart-empty" id="cartEmpty">Sua sacola está vazia.</p>`;
      return;
    }

    itemsEl.innerHTML = entries.map(({ product, qty }) => `
      <div class="cart-item" data-id="${product.id}">
        <div class="cart-item__thumb">${productThumb(product)}</div>
        <div>
          <p class="cart-item__name">${product.name}</p>
          <span class="cart-item__price">${currency(product.price)}</span>
          <div class="cart-item__qty">
            <button class="qty-minus" aria-label="Diminuir quantidade">−</button>
            <span>${qty}</span>
            <button class="qty-plus" aria-label="Aumentar quantidade">+</button>
          </div>
        </div>
        <button class="cart-item__remove">Remover</button>
      </div>
    `).join("");

    bindQtyControls(itemsEl);
  }

  function renderCheckoutList(entries, totalPrice) {
    const listEl = document.getElementById("checkoutItems");
    if (!listEl) return;

    const totalEl = document.getElementById("checkoutTotal");
    const emptyEl = document.getElementById("checkoutEmptyMsg");
    const confirmBtn = document.getElementById("confirmOrderBtn");

    if (emptyEl) emptyEl.style.display = entries.length === 0 ? "block" : "none";
    if (confirmBtn) confirmBtn.disabled = entries.length === 0;
    if (totalEl) totalEl.textContent = currency(totalPrice);

    listEl.innerHTML = entries.map(({ product, qty }) => `
      <div class="checkout-item" data-id="${product.id}">
        <div class="cart-item__thumb">${productThumb(product)}</div>
        <div class="checkout-item__info">
          <p class="checkout-item__name">${product.name}</p>
          <span class="checkout-item__price">${currency(product.price)} / unidade</span>
        </div>
        <div class="cart-item__qty">
          <button class="qty-minus" aria-label="Diminuir quantidade">−</button>
          <span>${qty}</span>
          <button class="qty-plus" aria-label="Aumentar quantidade">+</button>
        </div>
        <span class="checkout-item__subtotal">${currency(product.price * qty)}</span>
        <button class="cart-item__remove" aria-label="Remover item">Remover</button>
      </div>
    `).join("");

    bindQtyControls(listEl);
  }

  function openCart() {
    document.getElementById("cartDrawer").classList.add("active");
    document.getElementById("overlay").classList.add("active");
    document.getElementById("cartToggle").setAttribute("aria-expanded", "true");
    document.getElementById("cartDrawer").setAttribute("aria-hidden", "false");
  }

  function closeCart() {
    document.getElementById("cartDrawer").classList.remove("active");
    document.getElementById("overlay").classList.remove("active");
    document.getElementById("cartToggle").setAttribute("aria-expanded", "false");
    document.getElementById("cartDrawer").setAttribute("aria-hidden", "true");
  }

  /* ---------- 6. Menu mobile ---------- */
  function toggleMenu() {
    const nav = document.getElementById("nav");
    const btn = document.getElementById("menuToggle");
    const isActive = nav.classList.toggle("active");
    btn.setAttribute("aria-expanded", String(isActive));
  }

  /* ---------- 6b. Dropdown de categorias ---------- */
  function initCategoryDropdown() {
    const dropdown = document.querySelector(".nav-dropdown");
    const trigger = dropdown.querySelector(".nav-dropdown__trigger");

    trigger.addEventListener("click", () => {
      const isOpen = dropdown.classList.toggle("open");
      trigger.setAttribute("aria-expanded", String(isOpen));
    });

    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  /* ---------- 6c. Página de categoria ---------- */
  function initCategoryPage() {
    const tabs = document.getElementById("categoryTabs");
    if (!tabs) return;

    const cat = getCategoryFromURL();

    document.getElementById("categoryTitle").textContent = CATEGORY_LABELS[cat] || "Categoria";
    document.title = `TRAMA — ${CATEGORY_LABELS[cat] || "Categoria"}`;

    tabs.querySelectorAll("a").forEach((tab) => {
      tab.classList.toggle("active", (tab.dataset.cat || "") === cat);
    });

    renderProducts(cat || null);
  }

  /* ---------- 7. Formulário de newsletter ---------- */
  function handleNewsletter(e) {
    e.preventDefault();
    const input = document.getElementById("email");
    const msg = document.getElementById("formMsg");

    if (!input.checkValidity()) {
      msg.textContent = "Digite um e-mail válido.";
      return;
    }

    msg.textContent = `Cadastrado! Em breve novidades em ${input.value}.`;
    input.value = "";
  }

  /* ---------- 8. Autenticação real (Supabase Auth) ---------- */
  // Busca o papel (cliente/gerente) e o nome da pessoa logada, na tabela profiles.
  async function getCurrentProfile() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return null;

    const { data: profile, error } = await supabaseClient
      .from("profiles")
      .select("role, email, name")
      .eq("id", user.id)
      .single();

    if (error) return { id: user.id, email: user.email, name: null, role: "user" };
    return {
      id: user.id,
      email: profile.email || user.email,
      name: profile.name || null,
      role: profile.role,
    };
  }

  async function renderAccountUI() {
    const el = document.getElementById("headerAccount");
    if (!el) return;

    const profile = await getCurrentProfile();

    if (!profile) {
      el.innerHTML = `
        <a href="login.html" class="icon-btn" aria-label="Entrar ou criar conta" title="Entrar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <circle cx="12" cy="8" r="3.4"/>
            <path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4" stroke-linecap="round"/>
          </svg>
        </a>`;
      return;
    }

    // Mostra o nome; se ainda não tiver sido preenchido (contas criadas antes
    // dessa coluna existir), cai para a parte do e-mail antes do "@".
    const displayName = profile.name || profile.email.split("@")[0];

    const backofficeLink = profile.role === "manager"
      ? `<a href="backoffice.html" class="header__account-link">Backoffice</a>`
      : "";

    el.innerHTML = `
      <div class="header__account-menu">
        <span class="header__account-name">Olá, ${displayName}</span>
        ${backofficeLink}
        <button type="button" class="header__account-link" id="logoutBtn">Sair</button>
      </div>`;

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      window.location.href = "index.html";
    });
  }

  /* ---------- 8b. Mostrar/ocultar senha ---------- */
  function initPasswordToggles() {
    document.querySelectorAll(".password-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const willShow = input.type === "password";
        input.type = willShow ? "text" : "password";
        btn.setAttribute("aria-pressed", String(willShow));
        btn.setAttribute("aria-label", willShow ? "Ocultar senha" : "Mostrar senha");
      });
    });
  }

  /* ---------- 9. Página de login/cadastro (login.html) ---------- */
  function initAuthPage() {
    const tabLogin = document.getElementById("tabLogin");
    if (!tabLogin) return;

    const tabSignup = document.getElementById("tabSignup");
    const loginForm = document.getElementById("loginForm");
    const signupForm = document.getElementById("signupForm");

    function showTab(tab) {
      const isLogin = tab === "login";
      tabLogin.classList.toggle("active", isLogin);
      tabSignup.classList.toggle("active", !isLogin);
      tabLogin.setAttribute("aria-selected", String(isLogin));
      tabSignup.setAttribute("aria-selected", String(!isLogin));
      loginForm.hidden = !isLogin;
      signupForm.hidden = isLogin;
    }

    tabLogin.addEventListener("click", () => showTab("login"));
    tabSignup.addEventListener("click", () => showTab("signup"));

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("loginUser").value.trim();
      const password = document.getElementById("loginPass").value;
      const msg = document.getElementById("loginMsg");
      const submitBtn = loginForm.querySelector("button[type=submit]");

      msg.textContent = "Entrando...";
      submitBtn.disabled = true;

      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) {
        msg.textContent = "E-mail ou senha inválidos.";
        submitBtn.disabled = false;
        return;
      }

      const { data: profile } = await supabaseClient
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();

      window.location.href = profile?.role === "manager" ? "backoffice.html" : "index.html";
    });

    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("signupName").value.trim();
      const email = document.getElementById("signupEmail").value.trim();
      const password = document.getElementById("signupPass").value;
      const msg = document.getElementById("signupMsg");
      const submitBtn = signupForm.querySelector("button[type=submit]");

      msg.textContent = "Criando conta...";
      submitBtn.disabled = true;

      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });

      submitBtn.disabled = false;

      if (error) {
        msg.textContent = "Não foi possível criar a conta: " + error.message;
        return;
      }

      if (data.session) {
        // confirmação de e-mail desativada no projeto — já entra logado
        window.location.href = "index.html";
      } else {
        msg.textContent = "Conta criada! Confirme seu e-mail para poder entrar.";
      }
    });
  }

  /* ---------- 10. Backoffice (backoffice.html) ---------- */
  // Protege a página: só deixa passar quem estiver logado com papel "manager".
  // Retorna true se a página pode continuar sendo montada, false se redirecionou.
  async function guardManagerPage() {
    const guard = document.getElementById("authGuard");
    if (!guard) return true; // esta página não é protegida

    const profile = await getCurrentProfile();

    if (!profile) {
      window.location.replace("login.html");
      return false;
    }
    if (profile.role !== "manager") {
      window.location.replace("index.html");
      return false;
    }

    guard.remove();
    return true;
  }

  function initBackoffice() {
    const table = document.getElementById("adminTable");
    if (!table) return;

    const form = document.getElementById("productForm");
    const idField = document.getElementById("productId");
    const nameField = document.getElementById("fieldName");
    const categoryField = document.getElementById("fieldCategory");
    const priceField = document.getElementById("fieldPrice");
    const tagField = document.getElementById("fieldTag");
    const imageField = document.getElementById("fieldImage");
    const preview = document.getElementById("imagePreview");
    const submitLabel = document.getElementById("submitLabel");
    const cancelBtn = document.getElementById("cancelEdit");

    let pendingFile = null;   // arquivo novo escolhido, ainda não enviado
    let currentImageUrl = null; // url já salva no produto (ao editar)

    function resetForm() {
      form.reset();
      idField.value = "";
      pendingFile = null;
      currentImageUrl = null;
      preview.innerHTML = "";
      submitLabel.textContent = "Adicionar produto";
      submitLabel.disabled = false;
      cancelBtn.hidden = true;
    }

    imageField.addEventListener("change", () => {
      const file = imageField.files[0];
      if (!file) return;
      pendingFile = file;
      preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Pré-visualização">`;
    });

    async function refreshTable() {
      await getProducts(); // atualiza productsCache
      table.innerHTML = productsCache.length
        ? productsCache.map((p) => `
          <div class="admin-row" data-id="${p.id}">
            <div class="admin-row__thumb">${productThumb(p)}</div>
            <div class="admin-row__info">
              <strong>${p.name}</strong>
              <span>${CATEGORY_LABELS[p.category] || p.category} · ${currency(p.price)}${p.tag ? " · " + p.tag : ""}</span>
            </div>
            <div class="admin-row__actions">
              <button type="button" class="admin-row__edit">Editar</button>
              <button type="button" class="admin-row__remove">Remover</button>
            </div>
          </div>
        `).join("")
        : `<p class="cart-empty">Nenhum produto cadastrado.</p>`;

      table.querySelectorAll(".admin-row").forEach((row) => {
        const id = row.dataset.id;
        row.querySelector(".admin-row__edit").addEventListener("click", () => startEdit(id));
        row.querySelector(".admin-row__remove").addEventListener("click", async () => {
          if (!confirm("Remover este produto?")) return;
          const { error } = await supabaseClient.from("products").delete().eq("id", id);
          if (error) {
            alert("Erro ao remover: " + error.message);
            return;
          }
          await refreshTable();
        });
      });
    }

    function startEdit(id) {
      const product = productsCache.find((p) => p.id === id);
      if (!product) return;
      idField.value = product.id;
      nameField.value = product.name;
      categoryField.value = product.category;
      priceField.value = product.price;
      tagField.value = product.tag || "";
      pendingFile = null;
      currentImageUrl = product.image || null;
      preview.innerHTML = currentImageUrl ? `<img src="${currentImageUrl}" alt="Pré-visualização">` : "";
      submitLabel.textContent = "Salvar alterações";
      cancelBtn.hidden = false;
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    cancelBtn.addEventListener("click", resetForm);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submitLabel.disabled = true;
      submitLabel.textContent = "Salvando...";

      let imageUrl = currentImageUrl;

      // Se uma imagem nova foi escolhida, envia para o Storage antes de salvar o produto.
      if (pendingFile) {
        const filePath = `${Date.now()}-${sanitizeFileName(pendingFile.name)}`;
        const { error: uploadError } = await supabaseClient
          .storage.from("product-images")
          .upload(filePath, pendingFile, { upsert: true });

        if (uploadError) {
          alert("Erro ao enviar imagem: " + uploadError.message);
          submitLabel.disabled = false;
          submitLabel.textContent = idField.value ? "Salvar alterações" : "Adicionar produto";
          return;
        }

        const { data: urlData } = supabaseClient.storage.from("product-images").getPublicUrl(filePath);
        imageUrl = urlData.publicUrl;
      }

      const payload = {
        name: nameField.value.trim(),
        category: categoryField.value,
        price: parseFloat(priceField.value) || 0,
        tag: tagField.value.trim() || null,
        image_url: imageUrl,
      };

      const { error } = idField.value
        ? await supabaseClient.from("products").update(payload).eq("id", idField.value)
        : await supabaseClient.from("products").insert(payload);

      submitLabel.disabled = false;

      if (error) {
        alert("Erro ao salvar produto: " + error.message);
        submitLabel.textContent = idField.value ? "Salvar alterações" : "Adicionar produto";
        return;
      }

      resetForm();
      await refreshTable();
    });

    refreshTable();
  }

  /* ---------- 11. Inicialização ---------- */
  async function init() {
    initTheme();
    loadCart();

    // Em backoffice.html isto pode redirecionar a pessoa para longe daqui —
    // nesse caso, não faz sentido continuar montando o resto da página.
    const allowed = await guardManagerPage();
    if (!allowed) return;

    await getProducts(); // popula o cache de produtos, usado em qualquer página com carrinho
    await renderAccountUI();

    if (document.getElementById("categoryTabs")) {
      initCategoryPage();
    } else if (document.getElementById("productGrid")) {
      renderProducts();
    }
    renderCart();

    const cartToggle = document.getElementById("cartToggle");
    if (cartToggle) cartToggle.addEventListener("click", openCart);

    const cartClose = document.getElementById("cartClose");
    if (cartClose) cartClose.addEventListener("click", closeCart);

    const overlay = document.getElementById("overlay");
    if (overlay) overlay.addEventListener("click", closeCart);

    const checkoutBtn = document.getElementById("checkoutBtn");
    if (checkoutBtn) {
      checkoutBtn.addEventListener("click", () => {
        window.location.href = "checkout.html";
      });
    }

    const confirmBtn = document.getElementById("confirmOrderBtn");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        if (cart.size === 0) return;
        alert("Compra simulada — integre um checkout real (ex.: Stripe, Mercado Pago) aqui.");
      });
    }

    const menuToggle = document.getElementById("menuToggle");
    if (menuToggle) menuToggle.addEventListener("click", toggleMenu);

    document.querySelectorAll(".nav > a").forEach((link) =>
      link.addEventListener("click", () => document.getElementById("nav")?.classList.remove("active"))
    );

    if (document.querySelector(".nav-dropdown")) initCategoryDropdown();

    const newsletterForm = document.getElementById("newsletterForm");
    if (newsletterForm) newsletterForm.addEventListener("submit", handleNewsletter);

    initAuthPage();
    initPasswordToggles();
    initBackoffice();

    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCart();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
