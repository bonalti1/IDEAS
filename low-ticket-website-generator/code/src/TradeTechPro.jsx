import React, { useState, useMemo, useRef, useEffect } from "react";
import { fenceQuote, runFt, cornerIndexes } from "./fenceMath.js";
import { traverse as surveyTraverse, normalizeCalls as surveyNormalize } from "./surveyTraverse.js";

/* ─── Brand tokens (ALTO Pro: navy + gold) ─── */
const C = {
  navy: "#101B30",
  navyDeep: "#0B1322",
  orange: "#F8B408",
  orangeSoft: "#FEF5DC",
  bg: "#F4F5F7",
  card: "#FFFFFF",
  line: "#E6E8EC",
  slate: "#67718A",
  green: "#1E9E5A",
  greenSoft: "#E6F5EC",
  red: "#D64545",
  redSoft: "#FBEAEA",
  yellow: "#C98A06",
  yellowSoft: "#FCF3DD",
};

/* ─── Logo (ALTO Pro monogram: ring + A over gold P) ─── */
// The real ALTO Pro logo. White wordmark on dark backgrounds (color="#fff"),
// dark wordmark everywhere else.
const Logo = ({ size = 44, color = null }) => (
  <img src={color === "#fff" ? "/brand-logo-white.png" : "/brand-logo.png"} alt="ALTO Pro"
    style={{ height: size, width: "auto", display: "block" }}
    onError={(e) => { e.currentTarget.style.display = "none"; }} />
);

/* ─── Translations ─── */
const TR = {
  es: {
    hello: "Hola", today: "Hoy", theyOwe: "Te deben", soldLbl: "Vendido", collectedLbl: "Cobrado", jobs: "Trabajos",
    newEstimate: "Nuevo estimado", calculator: "CALCULADORA", payments: "Cobros / Pagos",
    newEstSub: "Crea un estimado desde cero", quickQuote: "Cotizar rápido", quickQuoteSub: "Todo manual, sin satélite",
    webPage: "Mi página web", webPageSub: "Mándala — el cliente cotiza solo",
    webShareTitle: "Tu página web", webIntro: "Manda tu trabajo a tu cliente — elige cómo:",
    webChoose: "Elige la que mejor le quede a tu cliente",
    webQuoteT: "Cotizador por satélite", webQuoteSub: "Mándalo a tu cliente. Él pone su dirección y recibe precio al instante — a ti te llega como Lead 📥.",
    webSiteT: "Tu página completa", webSiteSub: "Tu sitio web con tu marca y el cotizador adentro.",
    webSendWA: "Enviar por WhatsApp", webSendSMS: "Enviar por mensaje", webCopy: "Copiar link", webView: "Ver",
    webMsg: (biz) => `Hola 👋 Soy de ${biz}. Aquí puedes ver tu techo y recibir una cotización gratis en segundos — solo pon tu dirección:`,
    webShareNote: "El cliente ve tus precios y tu logo. Cámbialos en Ajustes ⚙️.",
    custSold: "Vendido", custPaid: "Pagado", custOwes: "Debe", custNoJobs: "Sin trabajos todavía",
    reqT: "¿NECESITAS UN CAMBIO?", reqSub: "Tu página, tu bot, tus horarios — pídelo y nuestro equipo lo hace por ti.",
    reqPh: "Ej. Cambien el horario del bot: ahora también trabajamos los sábados…",
    reqBtn: "📨 Enviar solicitud", reqSent: "✓ Solicitud enviada — un especialista la trabaja y te avisamos", reqFail: "No se pudo enviar — intenta de nuevo",
    reqKindQ: "¿De qué se trata?",
    reqKinds: [["bot", "🤖 El bot del chat"], ["web", "🌐 Mi página"], ["queja", "😕 Una queja"], ["any", "💬 Otra cosa"]],
    reqListT: "Mis solicitudes", reqListEmpty: "Sin solicitudes todavía",
    reqStOpen: "Recibida", reqStDoing: "En proceso", reqStDone: "✓ Lista",
    viPhotosT: "FOTOS DE LA CASA (OPCIONAL)", viPhotosSub: "Pon la dirección y tu factura sale con la foto de la casa y la vista aérea — se ve mucho más profesional.",
    viAddrPh: "123 Main St, McAllen", viNotFound: "No encontramos esa dirección", viAerial: "Vista aérea", viStreet: "La casa", viClear: "Quitar dirección",
    viPhotosPick: "Toca una foto para quitarla o ponerla:",
    scopeAI: "✨ Mejorar con IA", scopeAIFail: "La IA no está disponible ahorita",
    revT: "Pedir reseña ⭐", revDivider: "Y cuando termines el trabajo…", revSub: "Mándalo cuando termines un trabajo. Cliente feliz → deja 5 estrellas donde tengas presencia (Google, Facebook) y en tu página. Descontento → te lo dice en privado, no en público.",
    revMsg: (biz) => `¡Gracias por confiar en ${biz}! 🙏 ¿Nos ayudas con tu opinión? Toma 1 minuto:`,
    askReview: "⭐ Pedir reseña",
    jobsSub: "Ver trabajos y seguimiento", paysSub: "Facturas, pagos y balances",
    voiceSub: "Habla o escribe — factura al momento", aiSub: "Tu asistente de techos", aiSubFence: "Tu asistente de cercas", newBadge: "NUEVO",
    quickSummary: "Resumen rápido", statEstimates: "Estimados", jobStatus: "Estado del trabajo", reSendEst: "📤 Enviar estimado de nuevo", editJobT: "Editar trabajo", lines: "Líneas", cancel: "Cancelar", statActive: "Trabajos activos", statOwed: "Por cobrar", searchList: "Buscar cliente, trabajo, teléfono…", sortRecent: "Recientes", sortDebt: "Deben más", sortBig: "Mayor $", sortAZ: "A–Z",
    askTTP: "Pregúntale a ALTO AI", home: "Inicio", customers: "Clientes",
    yourName: "Tu nombre", bizName: "Nombre de tu negocio", phone: "Tu teléfono",
    continue: "CONTINUAR", whichTrade: "¿Cuál es tu oficio?", soon: "Próximamente",
    concrete: "Concreto", roofing: "Techos", plumbing: "Plomería", electric: "Eléctrico",
    painting: "Pintura", fence: "Cercas", landscaping: "Jardinería", pressure: "Lavado a presión",
    length: "Largo (ft)", width: "Ancho (ft)", thickness: "Grosor (in)", waste: "Desperdicio",
    result: "RESULTADO", cubicYards: "Yardas cúbicas", withWaste: "Con desperdicio",
    order: "Pide", trucks: "Camiones", optPrice: "OPCIONAL: PRECIO",
    pricePerYard: "Precio por yarda ($)", laborSqFt: "Mano de obra ($/sq ft)",
    material: "Material", labor: "Mano de obra", estTotal: "TOTAL ESTIMADO",
    toEstimate: "CONVERTIR A ESTIMADO →", forWho: "¿Para qué cliente?",
    addCustomer: "+ Agregar cliente", name: "Nombre", save: "GUARDAR",
    pickTabNew: "Nuevos", pickTabPrev: "Ya clientes", removeCustQ: "¿Quitar a", removeCustQ2: "de la lista?", custRemoved: "Cliente quitado",
    pickNoneNew: "No tienes direcciones nuevas por asignar todavía.", pickNonePrev: "Aún no tienes clientes anteriores.",
    estimate: "Estimado", ready: "listo", sendText: "📱 ENVIAR POR TEXTO",
    sendEmail: "✉️ ENVIAR POR EMAIL", sentTo: "Enviado por texto a",
    simulateAccept: "✓ Marcar como aceptado", accepted: "Aceptado",
    estimateSt: "Estimado", scheduled: "Programado", inProgress: "En Progreso",
    done: "Terminado", paid: "Pagado", pending: "PENDIENTE", partial: "PARCIAL",
    overdue: "Vencido", daysShort: "d", remind: "Recordar", reminderSent: "Recordatorio enviado a",
    genInvoice: "GENERAR FACTURA", invoice: "Factura", subtotal: "Subtotal",
    tax: "Impuesto (si aplica)", depositRec: "Depósito recibido", balance: "SALDO PENDIENTE",
    payNow: "💳 PAGAR AHORA", markPaid: "✓ Marcar como pagado", paidToast: "Pago registrado",
    regPay: "💵 Registrar pago", payAmt: "Cantidad recibida", payMethod: "Método",
    mZelle: "Zelle", mCash: "Efectivo", mCheck: "Cheque",
    sendReceipt: "🧾 Enviar recibo", recMsg: "Recibo de pago", payReg: "Pago registrado",
    job: "Trabajo", jobAddr: "Dirección del trabajo", photos: "Fotos", addPhoto: "📷 Agregar foto",
    notes: "Notas", status: "Estado", newJob: "+ NUEVO", noJobs: "Sin trabajos todavía. Crea tu primer estimado.",
    call: "Llamar", text: "Texto", history: "Historial", noPhone: "Este cliente no tiene teléfono",
    aiHint: "Escribe o toca el micrófono…", aiWelcome: "Pregúntame lo que sea de tu negocio", aiThinking: "Pensando…",
    aiChip1: "¿Cuántos cuadros son 1,800 sq ft con inclinación 6/12?",
    aiChip2: "¿Quién me debe dinero?",
    aiChip3: "¿Cuál es el precio de mercado por cuadro instalado?",
    aiChip4: "¿En qué áreas tengo más clientes?",
    aiChip5: "Redacta un recordatorio de pago amable",
    back: "Atrás", total: "Total", deposit: "Depósito (30%)",
    lineSlab: "Losa de concreto", lineMesh: "Malla de refuerzo", lineBase: "Base de gravilla",
    addons: "Extras", finish: "Acabado: escoba",
    welcome1: "Cotiza en 2 minutos.", welcome2: "Cobra más rápido.",
    madeFor: "HECHO PARA CONTRATISTAS",
    alreadyClient: "¿Ya eres cliente de ALTO Pro?",
    clientsOnly: "ALTO Pro es solo para clientes.",
    getStarted: "QUIERO ALTO PRO →",
    passPlaceholder: "Contraseña de acceso",
    enterBtn: "ENTRAR",
    wrongPass: "Contraseña incorrecta",
    loginTitle: "Entra a tu cuenta",
    loginHint: "Pega el link de acceso que te mandamos por WhatsApp 👇",
    loginPlaceholder: "Pega tu link de acceso",
    loginErr: "Ese link no es válido. Copia el que te mandamos por WhatsApp.",
    pausedTitle: "Tu cuenta está pausada",
    pausedMsg: "Tu pago no se completó. Actualiza tu método de pago para reactivar ALTO Pro. ¿Ya pagaste? Escríbenos y la reactivamos.",
    pausedBtn: "CONTACTAR A ALTO PRO",
    pushTitle: "Avisos de leads",
    pushDesc: "Recibe un aviso en tu teléfono apenas entre un lead — aunque la app esté cerrada.",
    pushEnable: "🔔 Activar avisos",
    pushOnLabel: "✅ Avisos activados",
    pushOff: "Apagar",
    pushOffLabel: "🔕 Avisos apagados en este teléfono",
    pushDenied: "Los avisos están bloqueados. Actívalos en los ajustes de tu teléfono.",
    pushInstallFirst: "Primero agrega la app a tu pantalla de inicio, luego activa los avisos.",
    pushErr: "No se pudieron activar los avisos. Intenta de nuevo.",
    pushUnsupported: "Tu teléfono no soporta avisos push.",
    instBanner: "Pon tu app en tu pantalla de inicio", instBannerSub: "Ábrela con un toque, como cualquier app", instBtn: "INSTALAR",
    instOverlayT: "📲 Instala tu app", instClose: "Listo, entendido",
    instWaIos: "¿La abriste desde WhatsApp? Primero toca ⋯ o ⬆️ y elige “Abrir en Safari”.",
    instWaAnd: "¿La abriste desde WhatsApp? Primero toca ⋮ arriba y elige “Abrir en Chrome”.",
    instAndSteps: ["1. Abre el menú ⋮ de Chrome (arriba a la derecha)", "2. Toca “Agregar a pantalla principal” o “Instalar app”", "3. Toca “Agregar” — y listo, el ícono aparece en tu pantalla"],
    installTitle: "Instalar la app",
    installDone: "✅ App instalada en tu teléfono.",
    installInstr: "Agrega ALTO Pro a tu pantalla de inicio para abrir más rápido y recibir avisos:",
    installIosSteps: ["1. Toca Compartir ⬆️ abajo en Safari", "2. Elige “Agregar a inicio”", "3. Deja “Abrir como app web” activado", "4. Abre el nuevo ícono de ALTO Pro"],
    installOther: "Abre el menú de tu navegador (⋮) y elige “Instalar app” o “Agregar a pantalla de inicio”.",
    demoBanner: "🧪 Modo demo — tus datos no se guardan en la nube. ¿Cliente? Entra con tu link de WhatsApp.",
    demoLimit: "El modo demo incluye 6 mediciones de prueba y ya las usaste. Los clientes de ALTO Pro miden sin límite.",
    demoCount: (u) => `🛰️ ${u}/6 mediciones gratis`,
    capTitle: "Usaste tus 6 mediciones gratis 🎯",
    capBody: "Ahora imagina esto con TU logo: tu propia app que cotiza cualquier techo en segundos — y una página web donde TUS clientes cotizan solos, y cada cotización te llega aquí, a tu teléfono.",
    capWA: "📲 Quiero la mía — hablar por WhatsApp",
    capWAmsg: "Hola 👋 Ya probé el demo de ALTO Pro 🛰️ y quiero hablar con alguien sobre mi app y mi página web.",
    capPlans: "Ver planes y precios",
    alreadyClientHint: "Entra con el link que te mandamos por WhatsApp — es tu llave personal. ¿Lo perdiste? Escríbenos y te mandamos uno nuevo.",
    aiErr: "No pude conectar. Intenta de nuevo.",
    estCreated: "Estimado creado",
    footprint: "Área de la casa (sq ft)", stories: "Pisos", pitch: "Inclinación (pitch)",
    roofArea: "Área del techo", squares: "Cuadros (squares)", matSquares: "Material",
    wasteTitle: "Merma (desperdicio)", wasteT10: "Sencillo", wasteT12: "Normal", wasteT15: "Cortado", wasteT20: "Muy cortado",
    approxNote: "≈ Estimado cercano, no exacto — siempre verifica en sitio. Ajusta los cuadros o la merma si hace falta.",
    materialType: "Material", tearOff: "Tear-off (quitar techo viejo)", layers: "Capas existentes",
    shingle3: "Shingle 3-tab", archShingle: "Shingle arquitectónico", metalRoof: "Metal", tileRoof: "Teja",
    matPerSq: "Material ($/sq)", laborPerSq: "Mano de obra ($/sq)", tearPerSq: "Tear-off ($/sq)",
    accessories: "Underlayment, drip edge, clavos", tearOffLine: "Tear-off y disposición",
    lineRoof: "Techo nuevo", storyNote: "+10% mano de obra por piso extra",
    measureTitle: "Medir techo", searchAddress: "Escribe la dirección…",
    measuring1: "Buscando imagen satelital…", measuring2: "Midiendo el techo…", measuring3: "Calculando cuadros…",
    satMeasured: "MEDIDO POR SATÉLITE", verifyOnSite: "Estimado satelital — verifica en sitio",
    segments: "Secciones del techo", propertyInfo: "DATOS DE LA PROPIEDAD",
    beds: "Recámaras", baths: "Baños", builtIn: "Construida", livingArea: "Área habitable",
    editSquares: "Cuadros (puedes editar)", manualMode: "✏️ Medir manualmente",
    noRoofData: "Sin datos satelitales para esta dirección. Usa la calculadora.",
    roofMeasured: "Techo medido", useThisAddr: "Buscar", suggestions: "SUGERENCIAS",
    sourceNote: "Datos reales de Google", imageryFrom: "imagen satelital de",
    verifyManual: "Confirma en sitio o ajusta los cuadros abajo",
    traceTitle: "Trazar techo", traceHint: "Toca las esquinas · ✌️ dos dedos mueven el mapa · ✋ para mover con un dedo",
    panHint: "✋ Mueve el mapa con un dedo · pellizca para acercar · toca ✋ otra vez para dibujar",
    verifyBtn: "✏️ VERIFICAR MANUAL",
    undo: "↩ Deshacer", clearAll: "✕ Borrar", closeSection: "✓ Cerrar sección",
    modePts: "Puntos", modeSq: "Cuadros", addSquare: "➕ Cuadro", delShape: "🗑 Borrar",
    sqHint: "Arrastra el cuadro · jala las esquinas · ✌️ dos dedos mueven el mapa",
    howMeasure: "¿Cómo quieres medir el techo?",
    pressArea: "Presiona el área", pressAreaSub: "marca las esquinas",
    makeSquares: "Haz cuadros", makeSquaresSub: "pon y ajusta cuadros",
    measMaybeOff: "La medición puede estar incompleta",
    measMaybeOffSub: "El satélite no alcanzó a captar todo el techo aquí. Mídelo a mano en ~10 segundos para cobrar con seguridad.",
    measManualBtn: "Medir a mano con cuadros",
    wrongHouseBtn: "¿No es la casa? Tócala en el mapa",
    reportBtn: "Reporte de medición (PDF)",
    tkBtn: "Takeoff lineal (beta)", tkErr: "No se pudo calcular el takeoff en esta casa.",
    tkLowData: "Los datos de elevación de Google en esta zona no alcanzan para un takeoff confiable",
    pinMaybeWrong: "Confirma que sea la casa correcta",
    pinMaybeWrongSub: "La dirección no se ubicó exacta en el mapa y pudo caer en la casa de al lado. Revisa la foto — si no es, tócala en el mapa y la medimos de nuevo.",
    pickHouseTitle: "Escoger la casa",
    pickHouseHint: "Toca el techo de la casa correcta y la medimos ahí mismo.",
    pickZoomOut: "Más lejos", pickZoomIn: "Más cerca",
    tracedArea: "Área trazada", useMeasure: "USAR ESTA MEDIDA →",
    traceOnPhoto: "✏️ Trazar en la foto", traced: "TRAZADO",
    tracedNote: "Trazado a mano sobre imagen de Google",
    noRoofTrace: "Sin medición automática — traza el techo en la foto",
    adjustDetails: "Ajustar detalles", shortVerify: "Verifica en sitio",
    useMyLocation: "Usar mi ubicación", atTheHouse: "Si estás frente a la casa", myLocation: "Mi ubicación", locating: "Buscando tu ubicación…",
    locErr: "No pude obtener tu ubicación. Activa el GPS y permite el acceso.",
    leads: "Leads", leadNew: "NUEVO", stContacted: "Contactado", stInterested: "Interesado", stHot: "🔥 Muy interesado", stLost: "No interesado", lostFolder: "No interesados", leadRestore: "↩ Regresar", custSub: "Historial y contacto", navPays: "Cobros", leadDone: "✓ Contactado", leadUndo: "Marcar nuevo",
    leadWhats: "WhatsApp", leadCall: "Llamar", leadEst: "Estimado", leadQuote: "Cotizar esta casa",
    leadsEmpty: "Aquí caen los clientes que piden precio en tu página web.",
    leadsEmptySub: "Cuando alguien deja su teléfono en tu sitio, te aparece aquí al instante.",
    leadMsg: (n, a, who) => `Hola${n ? " " + n : ""} 👋 Soy ${who}. Vi que pediste precio para tu techo${a ? " en " + a : ""}. ¿Cuándo puedo pasar a verlo? Es gratis y sin compromiso.`,
    settings: "Ajustes", brandSection: "TU MARCA", saved: "Guardado",
    bizSection: "MI NEGOCIO", emailLbl: "Email", licenseLbl: "Licencia / RCAT # (opcional)",
    pricesSection: "MIS PRECIOS", pricesHint: "Tus precios por cuadro (square). Cada estimado nuevo los usa automáticamente.",
    editPrices: "Editar precios", donePrices: "Listo", editHint: "Toca cualquier precio para cambiarlo — materiales y mano de obra. Toca “Listo” al terminar.",
    gmapHint: "Toca cada esquina del techo. Arrastra los puntos para ajustar. Pellizca para acercar.", useClassicMap: "Usar el mapa clásico",
    delCorner: "🗑 Esquina", delJob: "Eliminar este trabajo", delJobQ: "¿Eliminar este trabajo? No se puede deshacer.", delLeadQ: "¿Eliminar este lead?", otherSection: "➕ Otra sección",
    gmapAdjustHint: "Arrastra los puntos naranjas grandes. Toca un ＋ para agregar una esquina en ese lado. Toca un punto y bórralo con 🗑.",
    gmapAddHint: "Toca el mapa para poner cada esquina del techo.",
    sectionsLbl: "secciones",
    materialsSection: "MIS MATERIALES", materialsHint: "Tus productos y el precio del MATERIAL por escuadra. La mano de obra y el tear-off se ponen abajo.", materialsFenceHint: "Tus tipos de cerca y el precio POR PIE instalado. Las puertas se ponen abajo.",
    matNameLbl: "Nombre del material", addMaterial: "Agregar material",
    paySection: "PAGOS", zelleLbl: "Número de Zelle", zelleHint: "Vacío = usamos tu teléfono",
    proposalSection: "PROPUESTA", scopeLbl: "Lo que incluye el trabajo", scopeHint: "Una línea por punto. Aparece en cada propuesta — déjalo vacío para no mostrarlo.",
    scopeReset: "Usar lista profesional", warrantyTgl: "Incluir garantía", warrantyLbl: "Texto de la garantía", warrantyPh: "Ej: 10 años de garantía en mano de obra",
    acctSection: "MI CUENTA", changeTrade: "🔨 Cambiar oficio", logout: "Cerrar sesión",
    logoutQ: "¿Cerrar sesión? Tus datos quedan guardados en la nube.",
    viewPdf: "📄 VER PDF / IMPRIMIR", brandHint: "Tu logo aparece en estimados, facturas y el PDF que recibe tu cliente.",
    accHigh: "✓ Precisión alta · típicamente ±5%",
    accOld: "⚠️ Imagen antigua — verifica antes de ordenar",
    accMed: "⚠️ Calidad media — verifica antes de ordenar",
    accEst: "⚠️ Estimado del área de la casa — verifica",
    accTraced: "✏️ Medido por ti en la foto",
    quickInvoice: "Factura rápida", viSpeak: "Toca el micrófono y di: cliente, trabajo y monto",
    viExample: "“Para South Texas Builders: subida de teja 360 y también instalación de tejado 1,200”",
    viHeard: "Escuché", cust: "Cliente", concept: "Concepto", amount: "Monto ($)",
    createInvoice: "CREAR FACTURA →", viCreateEst: "📋 Crear estimado", sttErr: "No se pudo escuchar — intenta de nuevo", recStop: "Grabando… toca para terminar", transcribing: "Escuchando lo que dijiste…", viAddLine: "➕ Agregar otra línea", howToPay: "CÓMO PAGAR", payCash: "Efectivo o cheque aceptado",
    linkCopied: "Enlace copiado — pégalo en un mensaje", invMsg: "Factura", estMsg: "Estimado", fromMsg: "de",
    logoOpt: "LOGO DE TU NEGOCIO (OPCIONAL)", uploadLogo: "📷 Subir logo", removeLogo: "Quitar",
    obWelcome: "Vamos a configurar tu cuenta", obLang: "¿En qué idioma trabajas?", obBizQ: "¿Cómo se llama tu negocio?",
    obBizHint: "Puedes cambiarlo si quieres otro nombre.", obPricesQ: "Tus precios por escuadra", obPricesFenceQ: "Tus precios por pie", obLogoQ: "Tu logo (opcional)",
    obSkip: "Saltar", obSkipAll: "Saltar configuración →", obFinish: "✓ Listo, empezar",
    obEditLater: "Puedes cambiar todo esto después en Ajustes ⚙️",
    installHint: "Instala la app: toca Compartir ⬆️ y luego “Agregar a pantalla de inicio”",
    measureFence: "Medir cerca", fenceTitle: "Dibujar cerca",
    fenceHint: "ARRASTRA para dibujar la cerca · un toque = un poste · ✋ para mover el mapa",
    newFence: "Otra cerca",
    endRun: "✓ Terminar línea", totalLF: "Pies lineales", panels: "Paneles (8 ft)",
    posts: "Postes", cornerPosts: "Esquinas", walkGate: "Puerta sencilla", doubleGate: "Puerta doble",
    perLF: "Precio por pie ($)", walkPrice: "Puerta sencilla ($)", dblPrice: "Puerta doble ($)",
    markup: "Margen materiales (%)", cedar: "Cedro", vinyl: "Vinilo", chain: "Malla", alum: "Aluminio", ranch: "Rancho", custom: "Otro",
    lineFence: "Cerca", lineGates: "Puertas", lineMarkup: "Margen de materiales",
    fenceDrawn: "Cerca medida",
    propLine: "Línea de propiedad cargada — toca un lado para quitarlo o agregarlo",
    noParcel: "Sin línea de propiedad para esta dirección — dibuja la cerca en la foto",
    parcelFound: "Parcela encontrada",
    parcelErr: "El mapa de propiedades no respondió — dibuja a mano o vuelve a intentar",
    parcelAmbig: "Hay varios lotes en esa dirección — dibuja tu cerca a mano",
    parcelDemoDraw: "En el demo la cerca se dibuja a mano — los límites del lote automáticos vienen con tu cuenta",
    lookupFail: "No pudimos ubicar la dirección — revisa tu conexión e intenta de nuevo",
    aerialFail: "Imagen aérea no disponible",
    retryBtn: "Reintentar",
    fairUse: "Llegaste al límite diario de mediciones de tu cuenta — se reinicia mañana",
    fMeasuring1: "Ubicando la propiedad…", fMeasuring2: "Buscando los límites del lote…", fMeasuring3: "Preparando la medición…",
    confirmScreenT: "Confirmar propiedad",
    confirmTitle: "Encontramos esta propiedad. ¿Es la correcta?",
    confirmYes: "Sí, continuar",
    confirmOther: "Elegir otro lote",
    confirmPick: "Toca el lote correcto en el mapa",
    confirmDraw: "Dibujar a mano",
    parcelAmbig2: "Hay varios lotes cerca — toca el correcto",
    exTitle: "Prueba con un ejemplo real 🛰️",
    exSub: "En el demo, los límites de lote automáticos se muestran con estas propiedades de ejemplo. En tu cuenta, funciona con la dirección de tu cliente.",
    exDraw: "Dibujar a mano en mi dirección",
    exBadge: "EJEMPLO",
    parcelDisclaimer: "Límite catastral aproximado; no sustituye un levantamiento. Verifica marcadores, servidumbres, setbacks y reglas locales.",
    importSurvey: "Importar levantamiento",
    surveyReading: "Leyendo el levantamiento…",
    surveyDone: "Lote del levantamiento listo ✅",
    surveyRough: "Lote cargado — revisa los lados (el levantamiento no cerró perfecto)",
    surveyNone: "No pude leer los lados en esa imagen. Prueba una foto más nítida.",
    surveyErr: "No se pudo leer el levantamiento. Intenta de nuevo.",
    surveyLogin: "Entra a tu cuenta para leer levantamientos.",
    surveyTooBig: "La imagen es muy grande (máx. 12 MB).",
    surveyHint: "Foto o PDF del plano/levantamiento — leemos los lados exactos.",
    modeSides: "Lados", modeDraw: "Dibujar",
    presetFull: "Todo el perímetro", otherSide: "Usar el otro lado",
    presetBack: "Patio trasero",
    tapStreet: "Toca el lado de la CALLE (el frente de la casa)",
    backyardDone: "Patio y lados seleccionados — el frente quedó fuera",
    modeGate: "Puerta", tapGate: "Elige el tamaño abajo — la puerta aparece y la arrastras a su lugar",
    gateNeedsFence: "Primero pon la cerca — la puerta va montada en ella",
    addGate: "Agregar puerta",
    panelsLbl: "Paneles", panelWidth: "Panel (ft)",
    prodTitle: "Productos de cerca", prodAdd: "Agregar producto", prodHint: "Palomea los que ofreces — solo esos salen en la app",
    matBtn: "Ver precios de hoy — Home Depot", matLoading: "Buscando precios de hoy…", matUpdated: "actualizado", matFail: "No se pudieron cargar los precios",
    gWalk4: "Sencilla 4′", gDbl10: "Doble 10′", gDbl12: "Doble 12′", gDbl16: "Doble 16′",
    gateEdit: "Puerta", gateWidth: "Ancho", gatePrice: "Precio ($)",
    gate1: "puerta", gateN: "puertas", gateTapEdit: "toca una puerta para editar", done: "Listo", delete: "Borrar",
    tapStart: "Toca donde EMPIEZA la cerca (en la línea del lote)",
    dragHint: "arrastra ⚪ o la línea para moverla",
    tapToggle: "Toca un lado para QUITARLO o volverlo a poner",
    delLine: "Borrar línea",
    addFence: "Agregar cerca",
    tapEnd: "Ahora toca donde TERMINA — o toca el mismo punto para cancelar",
    adjustLot: "Ajustar lote",
    adjustHint: "🧭 Modo ajuste: arrastra para mover el lote Y la cerca juntos hasta alinearlos con la foto",
    adjustDone: "Lote alineado",
    directions: "Cómo llegar",
    prodImgSwap: "Buscar otra foto", prodImgFail: "No se encontró foto — intenta cambiar el nombre",
    boardNew: "Nuevos", boardHint: "Arrastra una tarjeta a otra columna para cambiar su etapa — como en cualquier CRM.",
    matForQuote: "Materiales para TU cerca", matTotal: "TOTAL MATERIALES", matFullList: "Lista completa de precios",
    matForNote: "Solo precios de Home Depot — referencia para comprar. Ajusta cantidades o precios si consigues mejor; no cambia tu cotización.",
    matSheet: "Hoja de materiales (para ti)",
  },
  en: {
    hello: "Hi", today: "Today", theyOwe: "They owe you", soldLbl: "Sold", collectedLbl: "Collected", jobs: "Jobs",
    newEstimate: "New estimate", calculator: "CALCULATOR", payments: "Billing / Payments",
    newEstSub: "Create an estimate from scratch", quickQuote: "Quick quote", quickQuoteSub: "All manual, no satellite",
    webPage: "My web page", webPageSub: "Send it — the client quotes themselves",
    webShareTitle: "Your web page", webIntro: "Send your work to your client — choose how:",
    webChoose: "Pick whichever fits your client best",
    webQuoteT: "Satellite quote tool", webQuoteSub: "Send it to your client. They enter their address and get an instant price — it comes to you as a Lead 📥.",
    webSiteT: "Your full website", webSiteSub: "Your branded site with the quote tool inside.",
    webSendWA: "Send on WhatsApp", webSendSMS: "Send a message", webCopy: "Copy link", webView: "View",
    webMsg: (biz) => `Hi 👋 This is ${biz}. Here you can see your roof and get a free quote in seconds — just enter your address:`,
    webShareNote: "The client sees your prices and your logo. Change them in Settings ⚙️.",
    custSold: "Sold", custPaid: "Paid", custOwes: "Owes", custNoJobs: "No jobs yet",
    reqT: "NEED A CHANGE?", reqSub: "Your website, your bot, your hours — ask and our team does it for you.",
    reqPh: "E.g. Update the bot's hours: we now work Saturdays too…",
    reqBtn: "📨 Send request", reqSent: "✓ Request sent — a specialist is on it, we'll let you know", reqFail: "Couldn't send — try again",
    reqKindQ: "What's it about?",
    reqKinds: [["bot", "🤖 The chat bot"], ["web", "🌐 My website"], ["queja", "😕 A complaint"], ["any", "💬 Something else"]],
    reqListT: "My requests", reqListEmpty: "No requests yet",
    reqStOpen: "Received", reqStDoing: "In progress", reqStDone: "✓ Done",
    viPhotosT: "HOUSE PHOTOS (OPTIONAL)", viPhotosSub: "Enter the address and your invoice comes out with the house photo and aerial view — much more professional.",
    viAddrPh: "123 Main St, McAllen", viNotFound: "We couldn't find that address", viAerial: "Aerial view", viStreet: "The home", viClear: "Remove address",
    viPhotosPick: "Tap a photo to remove or include it:",
    scopeAI: "✨ Improve with AI", scopeAIFail: "AI isn't available right now",
    revT: "Ask for a review ⭐", revDivider: "And when you finish the job…", revSub: "Send it when you finish a job. Happy client → 5 stars wherever you have presence (Google, Facebook) and on your website. Unhappy → they tell you in private, not in public.",
    revMsg: (biz) => `Thank you for trusting ${biz}! 🙏 Would you leave us your feedback? Takes 1 minute:`,
    askReview: "⭐ Ask for review",
    jobsSub: "Jobs and tracking", paysSub: "Invoices, payments, balances",
    voiceSub: "Speak or type — instant invoice", aiSub: "Your roofing assistant", aiSubFence: "Your fencing assistant", newBadge: "NEW",
    quickSummary: "Quick summary", statEstimates: "Estimates", jobStatus: "Job status", reSendEst: "📤 Send estimate again", editJobT: "Edit job", lines: "Lines", cancel: "Cancel", statActive: "Active jobs", statOwed: "To collect", searchList: "Search customer, job, phone…", sortRecent: "Recent", sortDebt: "Owe most", sortBig: "Biggest $", sortAZ: "A–Z",
    askTTP: "Ask ALTO AI", home: "Home", customers: "Customers",
    yourName: "Your name", bizName: "Your business name", phone: "Your phone",
    continue: "CONTINUE", whichTrade: "What's your trade?", soon: "Coming soon",
    concrete: "Concrete", roofing: "Roofing", plumbing: "Plumbing", electric: "Electrical",
    painting: "Painting", fence: "Fence", landscaping: "Landscaping", pressure: "Pressure washing",
    length: "Length (ft)", width: "Width (ft)", thickness: "Thickness (in)", waste: "Waste",
    result: "RESULT", cubicYards: "Cubic yards", withWaste: "With waste",
    order: "Order", trucks: "Trucks", optPrice: "OPTIONAL: PRICING",
    pricePerYard: "Price per yard ($)", laborSqFt: "Labor ($/sq ft)",
    material: "Material", labor: "Labor", estTotal: "ESTIMATED TOTAL",
    toEstimate: "CONVERT TO ESTIMATE →", forWho: "Which customer?",
    addCustomer: "+ Add customer", name: "Name", save: "SAVE",
    pickTabNew: "New", pickTabPrev: "Previous clients", removeCustQ: "Remove", removeCustQ2: "from the list?", custRemoved: "Customer removed",
    pickNoneNew: "No new addresses to assign yet.", pickNonePrev: "No previous clients yet.",
    estimate: "Estimate", ready: "ready", sendText: "📱 SEND BY TEXT",
    sendEmail: "✉️ SEND BY EMAIL", sentTo: "Sent by text to",
    simulateAccept: "✓ Mark as accepted", accepted: "Accepted",
    estimateSt: "Estimate", scheduled: "Scheduled", inProgress: "In Progress",
    done: "Done", paid: "Paid", pending: "PENDING", partial: "PARTIAL",
    overdue: "Overdue", daysShort: "d", remind: "Remind", reminderSent: "Reminder sent to",
    genInvoice: "GENERATE INVOICE", invoice: "Invoice", subtotal: "Subtotal",
    tax: "Tax (if applies)", depositRec: "Deposit received", balance: "BALANCE DUE",
    payNow: "💳 PAY NOW", markPaid: "✓ Mark as paid", paidToast: "Payment recorded",
    regPay: "💵 Record payment", payAmt: "Amount received", payMethod: "Method",
    mZelle: "Zelle", mCash: "Cash", mCheck: "Check",
    sendReceipt: "🧾 Send receipt", recMsg: "Payment receipt", payReg: "Payment recorded",
    job: "Job", jobAddr: "Job address", photos: "Photos", addPhoto: "📷 Add photo",
    notes: "Notes", status: "Status", newJob: "+ NEW", noJobs: "No jobs yet. Create your first estimate.",
    call: "Call", text: "Text", history: "History", noPhone: "This customer has no phone number",
    aiHint: "Type or tap the mic…", aiWelcome: "Ask me anything about your business", aiThinking: "Thinking…",
    aiChip1: "How many squares is 1,800 sq ft at 6/12 pitch?",
    aiChip2: "Who owes me money?",
    aiChip3: "What's the market price per square installed?",
    aiChip4: "Which areas have most of my customers?",
    aiChip5: "Draft a friendly payment reminder",
    back: "Back", total: "Total", deposit: "Deposit (30%)",
    lineSlab: "Concrete slab", lineMesh: "Reinforcement mesh", lineBase: "Gravel base",
    addons: "Add-ons", finish: "Finish: broom",
    welcome1: "Quote in 2 minutes.", welcome2: "Get paid faster.",
    madeFor: "BUILT FOR CONTRACTORS",
    alreadyClient: "Already an ALTO Pro client?",
    clientsOnly: "ALTO Pro is for clients only.",
    getStarted: "I WANT ALTO PRO →",
    passPlaceholder: "Access password",
    enterBtn: "ENTER",
    wrongPass: "Wrong password",
    loginTitle: "Log in to your account",
    loginHint: "Paste the access link we sent you on WhatsApp 👇",
    loginPlaceholder: "Paste your access link",
    loginErr: "That link isn't valid. Copy the one we sent you on WhatsApp.",
    pausedTitle: "Your account is paused",
    pausedMsg: "Your payment didn't go through. Update your payment method to reactivate ALTO Pro. Already paid? Message us and we'll turn it back on.",
    pausedBtn: "CONTACT ALTO PRO",
    pushTitle: "Lead alerts",
    pushDesc: "Get a notification on your phone the moment a lead comes in — even when the app is closed.",
    pushEnable: "🔔 Turn on alerts",
    pushOnLabel: "✅ Alerts on",
    pushOff: "Turn off",
    pushOffLabel: "🔕 Alerts off on this phone",
    pushDenied: "Notifications are blocked. Turn them on in your phone settings.",
    pushInstallFirst: "Add the app to your home screen first, then turn on alerts.",
    pushErr: "Couldn't turn on alerts. Try again.",
    pushUnsupported: "Your phone doesn't support push alerts.",
    instBanner: "Put your app on your home screen", instBannerSub: "Open it with one tap, like any app", instBtn: "INSTALL",
    instOverlayT: "📲 Install your app", instClose: "Got it",
    instWaIos: "Opened from WhatsApp? First tap ⋯ or ⬆️ and choose “Open in Safari”.",
    instWaAnd: "Opened from WhatsApp? First tap ⋮ at the top and choose “Open in Chrome”.",
    instAndSteps: ["1. Open Chrome's ⋮ menu (top right)", "2. Tap “Add to Home screen” or “Install app”", "3. Tap “Add” — done, the icon appears on your screen"],
    installTitle: "Install the app",
    installDone: "✅ App installed on your phone.",
    installInstr: "Add ALTO Pro to your home screen to open faster and get alerts:",
    installIosSteps: ["1. Tap Share ⬆️ at the bottom of Safari", "2. Choose “Add to Home Screen”", "3. Keep “Open as Web App” ON", "4. Open the new ALTO Pro icon"],
    installOther: "Open your browser menu (⋮) and choose “Install app” or “Add to Home screen.”",
    demoBanner: "🧪 Demo mode — your data isn't saved to the cloud. Client? Enter with your WhatsApp link.",
    demoLimit: "The demo includes 6 trial measurements and you've used them. ALTO Pro clients measure with no limits.",
    demoCount: (u) => `🛰️ ${u}/6 free measurements`,
    capTitle: "You've used your 6 free measurements 🎯",
    capBody: "Now imagine this with YOUR logo: your own app quoting any roof in seconds — plus a website where YOUR customers quote themselves, and every quote lands right here on your phone.",
    capWA: "📲 I want mine — chat on WhatsApp",
    capWAmsg: "Hi 👋 I just tried the ALTO Pro demo 🛰️ and I want to talk to someone about my app and my website.",
    capPlans: "See plans & pricing",
    alreadyClientHint: "Enter with the link we sent you on WhatsApp — it's your personal key. Lost it? Message us and we'll send a new one.",
    aiErr: "Couldn't connect. Try again.",
    estCreated: "Estimate created",
    footprint: "House footprint (sq ft)", stories: "Stories", pitch: "Pitch",
    roofArea: "Roof area", squares: "Squares", matSquares: "Material",
    wasteTitle: "Waste", wasteT10: "Simple", wasteT12: "Normal", wasteT15: "Cut-up", wasteT20: "Complex",
    approxNote: "≈ Close estimate, not exact — always verify on site. Adjust the squares or waste if needed.",
    materialType: "Material", tearOff: "Tear-off (remove old roof)", layers: "Existing layers",
    shingle3: "3-tab shingle", archShingle: "Architectural shingle", metalRoof: "Metal", tileRoof: "Tile",
    matPerSq: "Material ($/sq)", laborPerSq: "Labor ($/sq)", tearPerSq: "Tear-off ($/sq)",
    accessories: "Underlayment, drip edge, nails", tearOffLine: "Tear-off & disposal",
    lineRoof: "New roof", storyNote: "+10% labor per extra story",
    measureTitle: "Measure roof", searchAddress: "Type the address…",
    measuring1: "Finding satellite imagery…", measuring2: "Measuring the roof…", measuring3: "Calculating squares…",
    satMeasured: "MEASURED BY SATELLITE", verifyOnSite: "Satellite estimate — verify on site",
    segments: "Roof sections", propertyInfo: "PROPERTY INFO",
    beds: "Bedrooms", baths: "Baths", builtIn: "Built", livingArea: "Living area",
    editSquares: "Squares (you can edit)", manualMode: "✏️ Measure manually",
    noRoofData: "No satellite data for this address. Use the calculator.",
    roofMeasured: "Roof measured", useThisAddr: "Search", suggestions: "SUGGESTIONS",
    sourceNote: "Real data from Google", imageryFrom: "satellite imagery from",
    verifyManual: "Confirm on site or adjust the squares below",
    traceTitle: "Trace roof", traceHint: "Tap the corners · ✌️ two fingers move the map · ✋ to move with one finger",
    panHint: "✋ One finger moves the map · pinch to zoom · tap ✋ again to draw",
    verifyBtn: "✏️ VERIFY MANUALLY",
    undo: "↩ Undo", clearAll: "✕ Clear", closeSection: "✓ Close section",
    modePts: "Points", modeSq: "Squares", addSquare: "➕ Square", delShape: "🗑 Delete",
    sqHint: "Drag the box · pull the corners · ✌️ two fingers move the map",
    howMeasure: "How do you want to measure?",
    pressArea: "Press the area", pressAreaSub: "tap the corners",
    makeSquares: "Make squares", makeSquaresSub: "drop & adjust boxes",
    measMaybeOff: "This measurement may be incomplete",
    measMaybeOffSub: "The satellite didn't capture the whole roof here. Measure it by hand in ~10 seconds to quote with confidence.",
    measManualBtn: "Measure by hand with squares",
    wrongHouseBtn: "Wrong house? Tap the right one",
    reportBtn: "Measurement report (PDF)",
    tkBtn: "Linear takeoff (beta)", tkErr: "Couldn't compute the takeoff for this home.",
    tkLowData: "Google's elevation data in this area isn't good enough for a reliable takeoff",
    pinMaybeWrong: "Confirm it's the right house",
    pinMaybeWrongSub: "The address didn't pin exactly on the map and may have landed on the house next door. Check the photo — if it's wrong, tap the right one and we'll re-measure.",
    pickHouseTitle: "Pick the house",
    pickHouseHint: "Tap the roof of the right house and we'll re-measure right there.",
    pickZoomOut: "Zoom out", pickZoomIn: "Zoom in",
    tracedArea: "Traced area", useMeasure: "USE THIS MEASUREMENT →",
    traceOnPhoto: "✏️ Trace on the photo", traced: "TRACED",
    tracedNote: "Hand-traced on Google imagery",
    noRoofTrace: "No automatic measurement — trace the roof on the photo",
    adjustDetails: "Adjust details", shortVerify: "Verify on site",
    useMyLocation: "Use my location", atTheHouse: "If you're at the house", myLocation: "My location", locating: "Finding your location…",
    locErr: "Couldn't get your location. Turn on GPS and allow access.",
    leads: "Leads", leadNew: "NEW", stContacted: "Contacted", stInterested: "Interested", stHot: "🔥 Very interested", stLost: "Not interested", lostFolder: "Not interested", leadRestore: "↩ Bring back", custSub: "History & contact", navPays: "Billing", leadDone: "✓ Contacted", leadUndo: "Mark new",
    leadWhats: "WhatsApp", leadCall: "Call", leadEst: "Estimate", leadQuote: "Quote this house",
    leadsEmpty: "Customers who ask for a price on your website land here.",
    leadsEmptySub: "When someone leaves their phone on your site, it shows up here instantly.",
    leadMsg: (n, a, who) => `Hi${n ? " " + n : ""} 👋 This is ${who}. I saw you asked for a roof price${a ? " at " + a : ""}. When can I stop by? It's free, no obligation.`,
    settings: "Settings", brandSection: "YOUR BRAND", saved: "Saved",
    bizSection: "MY BUSINESS", emailLbl: "Email", licenseLbl: "License # (optional)",
    pricesSection: "MY PRICES", pricesHint: "Your prices per square. Every new estimate uses them automatically.",
    editPrices: "Edit prices", donePrices: "Done", editHint: "Tap any price to change it — materials and labor. Tap “Done” when finished.",
    gmapHint: "Tap each corner of the roof. Drag the points to adjust. Pinch to zoom.", useClassicMap: "Use the classic map",
    delCorner: "🗑 Corner", delJob: "Delete this job", delJobQ: "Delete this job? This cannot be undone.", delLeadQ: "Delete this lead?", otherSection: "➕ Another section",
    gmapAdjustHint: "Drag the big orange dots. Tap a ＋ to add a corner on that side. Tap a dot, then 🗑 to delete it.",
    gmapAddHint: "Tap the map to drop each corner of the roof.",
    sectionsLbl: "sections",
    materialsSection: "MY MATERIALS", materialsHint: "Your products and the MATERIAL price per square. Labor and tear-off are set below.", materialsFenceHint: "Your fence types and the price PER FOOT installed. Gates are set below.",
    matNameLbl: "Material name", addMaterial: "Add material",
    paySection: "PAYMENTS", zelleLbl: "Zelle number", zelleHint: "Empty = we use your phone",
    proposalSection: "PROPOSAL", scopeLbl: "What the job includes", scopeHint: "One line per item. Shows on every proposal — leave empty to hide it.",
    scopeReset: "Use a professional list", warrantyTgl: "Include a warranty", warrantyLbl: "Warranty text", warrantyPh: "e.g., 10-year workmanship warranty",
    acctSection: "MY ACCOUNT", changeTrade: "🔨 Change trade", logout: "Log out",
    logoutQ: "Log out? Your data stays saved in the cloud.",
    viewPdf: "📄 VIEW PDF / PRINT", brandHint: "Your logo appears on estimates, invoices, and the PDF your client receives.",
    accHigh: "✓ High accuracy · typically ±5%",
    accOld: "⚠️ Older imagery — verify before ordering",
    accMed: "⚠️ Medium quality — verify before ordering",
    accEst: "⚠️ Estimated from home size — verify",
    accTraced: "✏️ Measured by you on the photo",
    quickInvoice: "Quick invoice", viSpeak: "Tap the mic and say: customer, job, and amount",
    viExample: "“For South Texas Builders: shingle load 360 and also roof installation 1,200”",
    viHeard: "Heard", cust: "Customer", concept: "Description", amount: "Amount ($)",
    createInvoice: "CREATE INVOICE →", viCreateEst: "📋 Create estimate", sttErr: "Couldn't hear that — try again", recStop: "Recording… tap to finish", transcribing: "Transcribing what you said…", viAddLine: "➕ Add another line", howToPay: "HOW TO PAY", payCash: "Cash or check accepted",
    linkCopied: "Link copied — paste it in a message", invMsg: "Invoice", estMsg: "Estimate", fromMsg: "from",
    logoOpt: "YOUR BUSINESS LOGO (OPTIONAL)", uploadLogo: "📷 Upload logo", removeLogo: "Remove",
    obWelcome: "Let's set up your account", obLang: "What language do you work in?", obBizQ: "What's your business name?",
    obBizHint: "Change it if you want a different name.", obPricesQ: "Your prices per square", obPricesFenceQ: "Your prices per foot", obLogoQ: "Your logo (optional)",
    obSkip: "Skip", obSkipAll: "Skip setup →", obFinish: "✓ Done, start",
    obEditLater: "You can change all this later in Settings ⚙️",
    installHint: "Install the app: tap Share ⬆️ then “Add to Home Screen”",
    measureFence: "Measure fence", fenceTitle: "Draw fence",
    fenceHint: "DRAG to draw the fence · one tap = one post · ✋ to move the map",
    newFence: "New fence",
    endRun: "✓ End line", totalLF: "Linear feet", panels: "Panels (8 ft)",
    posts: "Posts", cornerPosts: "Corners", walkGate: "Walk gate", doubleGate: "Double gate",
    perLF: "Price per foot ($)", walkPrice: "Walk gate ($)", dblPrice: "Double gate ($)",
    markup: "Material markup (%)", cedar: "Cedar", vinyl: "Vinyl", chain: "Chain link", alum: "Aluminum", ranch: "Ranch", custom: "Custom",
    lineFence: "Fence", lineGates: "Gates", lineMarkup: "Material markup",
    fenceDrawn: "Fence measured",
    propLine: "Property line loaded — tap a side to remove or add it",
    noParcel: "No property line for this address — draw the fence on the photo",
    parcelFound: "Parcel found",
    parcelErr: "The property-line service didn't respond — draw by hand or try again",
    parcelAmbig: "Several lots match that address — draw your fence by hand",
    parcelDemoDraw: "In the demo you draw the fence by hand — automatic lot boundaries come with your account",
    lookupFail: "We couldn't locate that address — check your connection and try again",
    aerialFail: "Aerial image unavailable",
    retryBtn: "Retry",
    fairUse: "You reached your account's daily measuring limit — it resets tomorrow",
    fMeasuring1: "Locating the property…", fMeasuring2: "Finding the lot boundaries…", fMeasuring3: "Preparing the measurement…",
    confirmScreenT: "Confirm property",
    confirmTitle: "We found this property. Is it the right one?",
    confirmYes: "Yes, continue",
    confirmOther: "Pick another lot",
    confirmPick: "Tap the correct lot on the map",
    confirmDraw: "Draw by hand",
    parcelAmbig2: "Several lots nearby — tap the right one",
    exTitle: "Try a real example 🛰️",
    exSub: "In the demo, automatic lot boundaries are shown on these example properties. On your account, it works at your customer's address.",
    exDraw: "Draw by hand at my address",
    exBadge: "EXAMPLE",
    parcelDisclaimer: "Approximate cadastral boundary; not a survey. Verify markers, easements, setbacks and local rules.",
    importSurvey: "Import survey",
    surveyReading: "Reading the survey…",
    surveyDone: "Survey lot ready ✅",
    surveyRough: "Lot loaded — check the sides (the survey didn't close perfectly)",
    surveyNone: "Couldn't read the sides in that image. Try a sharper photo.",
    surveyErr: "Couldn't read the survey. Try again.",
    surveyLogin: "Sign in to your account to read surveys.",
    surveyTooBig: "Image is too large (max 12 MB).",
    surveyHint: "Photo or PDF of the plat/survey — we read the exact sides.",
    modeSides: "Sides", modeDraw: "Draw",
    presetFull: "Whole perimeter", otherSide: "Use the other side",
    presetBack: "Backyard",
    tapStreet: "Tap the STREET side (the front of the house)",
    backyardDone: "Backyard and sides selected — the front stays open",
    modeGate: "Gate", tapGate: "Pick a size below — the gate appears and you drag it into place",
    gateNeedsFence: "Draw the fence first — the gate sits on it",
    addGate: "Add gate",
    panelsLbl: "Panels", panelWidth: "Panel (ft)",
    prodTitle: "Fence products", prodAdd: "Add product", prodHint: "Check the ones you offer — only those show in the app",
    matBtn: "Today's prices — Home Depot", matLoading: "Fetching today's prices…", matUpdated: "updated", matFail: "Couldn't load prices",
    gWalk4: "Walk 4′", gDbl10: "Double 10′", gDbl12: "Double 12′", gDbl16: "Double 16′",
    gateEdit: "Gate", gateWidth: "Width", gatePrice: "Price ($)",
    gate1: "gate", gateN: "gates", gateTapEdit: "tap a gate to edit", done: "Done", delete: "Delete",
    tapStart: "Tap where the fence STARTS (on the lot line)",
    dragHint: "drag ⚪ or the line to move it",
    tapToggle: "Tap a side to REMOVE it or put it back",
    delLine: "Delete line",
    addFence: "Add fence",
    tapEnd: "Now tap where it ENDS — or tap the same point to cancel",
    adjustLot: "Adjust lot",
    adjustHint: "🧭 Adjust mode: drag to move the lot AND the fence together until they line up with the photo",
    adjustDone: "Lot aligned",
    directions: "Directions",
    prodImgSwap: "Find another photo", prodImgFail: "No photo found — try changing the name",
    boardNew: "New", boardHint: "Drag a card to another column to change its stage — like any CRM.",
    matForQuote: "Materials for YOUR fence", matTotal: "MATERIALS TOTAL", matFullList: "Full price list",
    matForNote: "Home Depot prices only — a shopping reference. Adjust quantities or prices if you find better; it never changes your quote.",
    matSheet: "Materials sheet (for you)",
  },
};

/* ─── Seed data ─── */
const seedCustomers = [
  { id: 1, name: "María Garza", phone: "(956) 555-0143", addr: "456 Oak Dr, Rio Grande City, TX" },
  { id: 2, name: "José Pérez", phone: "(956) 555-0188", addr: "210 Mesquite Ln, Roma, TX" },
  { id: 3, name: "Ana Ríos", phone: "(956) 555-0102", addr: "88 Palma St, La Grulla, TX" },
];
// Demo-mode leads (the sales deck's phone): the Leads folder looks worked-in
// before the prospect's own live lead drops on top as NUEVO.
const seedLeads = [
  { id: "seed1", name: "Carlos Treviño", phone: "9565550171", address: "1204 Fresno Ave, McAllen, TX", status: "contacted", created_at: new Date(Date.now() - 864e5).toISOString(), info: { low: 9500, high: 12800 } },
  { id: "seed2", name: "Lupita Márquez", phone: "9565550152", address: "77 Ébano St, Misión, TX", status: "hot", created_at: new Date(Date.now() - 3 * 864e5).toISOString(), info: {} },
];
const seedJobs = [
  { id: 101, inv: 1040, custId: 1, title: { es: "Techo nuevo 24 sq, arquitectónico", en: "New roof 24 sq, architectural" }, amount: 8580, paidAmt: 2574, status: "accepted", days: 3, photos: 2, lines: [["lineRoof", 2970], ["accessories", 810], ["tearOffLine", 1200], ["labor", 3600]] },
  { id: 102, inv: 1038, custId: 2, title: { es: "Techo metálico 31 sq", en: "Metal roof 31 sq" }, amount: 14200, paidAmt: 14200, status: "paid", days: 0, photos: 6, lines: [["lineRoof", 8500], ["accessories", 1100], ["labor", 4600]] },
  { id: 103, inv: 1035, custId: 3, title: { es: "Reparación de goteras", en: "Leak repair" }, amount: 1150, paidAmt: 0, status: "done", days: 12, photos: 3, lines: [["labor", 1150]] },
];

const fmt = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

/* ─── Roof / property lookup (DEMO — simulated data; swap for Google Solar API + property data API) ─── */
const PITCH_FACTORS = { 3: 1.031, 4: 1.054, 5: 1.083, 6: 1.118, 7: 1.158, 8: 1.202, 9: 1.25, 10: 1.302, 12: 1.414 };
const MAT_PRICES = { three: 95, arch: 110, metal: 250, tile: 350 };
// The contractor's own list of products (name + MATERIAL $/square — labor and
// tear-off are separate lines, so these are material-only, not all-in).
// Editable in Settings; just starting suggestions he can rename/reprice.
const DEFAULT_MATERIALS = [
  { n: "Shingle 3-tab", p: 110 },
  { n: "Shingle 30 años", p: 130 },
  { n: "Shingle 50 años", p: 170 },
  { n: "Metal", p: 280 },
];
const FENCE_PRICES = { cedar: 28, vinyl: 38, chain: 18, alum: 45, ranch: 20, custom: 30 };
// Fence accounts: default price list is fence types $/linear-foot installed.
const FENCE_MATERIALS = [
  { n: "Cedro", p: 28 },
  { n: "Vinilo", p: 38 },
  { n: "Malla ciclónica", p: 18 },
  { n: "Aluminio", p: 45 },
  { n: "Rancho (tubo/riel)", p: 20 },
];
// Google Solar reads slightly low (it drops small/tree-covered roof planes), so
// suggested squares get a modest bump. Field-calibrated: a 28sq reading on a
// cut-up roof that really took 34sq lands right with cal + 15% waste.
const SAT_CAL = 1.05;
// Waste tier suggested from what the satellite saw: more roof sections and
// steeper pitch = more cuts = more scrap. The contractor can always override.
const WASTE_TIERS = [10, 12, 15, 20];
const suggestWaste = (segments, pitchKey) => {
  const s = segments || 1;
  let i = s <= 3 ? 0 : s <= 5 ? 1 : s <= 7 ? 2 : 3;
  if ((parseInt(pitchKey) || 6) >= 8) i = Math.min(i + 1, 3);
  return WASTE_TIERS[i];
};
// Default "scope of work" for the proposal — fully editable per contractor.
const DEFAULT_SCOPE_ES = ["Retiro del techo viejo y acarreo de escombro", "Inspección de la madera (reemplazo si está dañada)", "Underlayment (fieltro) nuevo y drip edge", "Teja arquitectónica instalada", "Sellado de chimenea, tubos y ventilas (flashing)", "Limpieza completa con imán para clavos"].join("\n");
const DEFAULT_SCOPE_EN = ["Tear off the old roof and haul away debris", "Inspect decking (replace damaged wood if needed)", "New underlayment and drip edge", "Architectural shingles installed", "Flashing at chimney, pipes and vents", "Full cleanup with a nail magnet"].join("\n");

const MOCK_PROPERTIES = [
  { addr: "456 Oak Dr, Rio Grande City, TX", roofArea: 2460, pitch: "6", stories: 1, beds: 3, baths: 2, sqft: 1850, year: 2004, segments: 4 },
  { addr: "210 Mesquite Ln, Roma, TX", roofArea: 3120, pitch: "4", stories: 1, beds: 4, baths: 2, sqft: 2400, year: 1998, segments: 6 },
  { addr: "88 Palma St, La Grulla, TX", roofArea: 1690, pitch: "5", stories: 1, beds: 2, baths: 1, sqft: 1240, year: 1987, segments: 2 },
  { addr: "1204 Cenizo Ct, Rio Grande City, TX", roofArea: 3890, pitch: "8", stories: 2, beds: 4, baths: 3, sqft: 2980, year: 2019, segments: 8 },
  { addr: "35 Rancho Viejo Rd, Garciasville, TX", noData: true },
];

const hashAddr = (s) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 99991; return h; };

/* ─── Trace geometry ───
 * The trace image is a 640×400 static map at scale 2 (1280×800 natural px).
 * Traced points are stored as [lat, lng] so they survive zooming and panning;
 * they're projected to image pixels for display via Web Mercator. */
const TRACE_W = 1280, TRACE_H = 800;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const llToPx = ([lat, lng], v) => {
  const worldN = 256 * Math.pow(2, v.zoom) * 2; // natural px per 360°
  // v.H: taller views (fence map is 1280×1280 square) carry their own height
  return [
    ((lng - v.lng) / 360) * worldN + TRACE_W / 2,
    ((mercY(v.lat) - mercY(lat)) / (2 * Math.PI)) * worldN + (v.H || TRACE_H) / 2,
  ];
};
const pxToLl = (x, y, v) => {
  const worldN = 256 * Math.pow(2, v.zoom) * 2;
  const lng = v.lng + ((x - TRACE_W / 2) * 360) / worldN;
  const my = mercY(v.lat) - ((y - (v.H || TRACE_H) / 2) * 2 * Math.PI) / worldN;
  const lat = ((2 * Math.atan(Math.exp(my)) - Math.PI / 2) * 180) / Math.PI;
  return [lat, lng];
};
const traceAreaSqft = (pts) => {
  if (pts.length < 3) return 0;
  const R = 6378137, k = Math.PI / 180;
  const [lat0, lng0] = pts[0];
  const xy = pts.map(([la, ln]) => [(ln - lng0) * k * R * Math.cos(lat0 * k), (la - lat0) * k * R]);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    a += x1 * y2 - x2 * y1;
  }
  return (Math.abs(a) / 2) * 10.7639;
};
const distFt = (a, b) => {
  const k = Math.PI / 180, R = 6378137;
  return Math.hypot((b[1] - a[1]) * k * R * Math.cos(a[0] * k), (b[0] - a[0]) * k * R) * 3.28084;
};
// point-in-polygon over a [lat,lng] ring (candidate picking on the confirm map)
const pointInRingApp = (lat, lng, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// The satellite mask outline often carries 12+ points for what is really a
// 6-corner roof — every extra point becomes a confusing dot on the trace map.
// Douglas-Peucker in local feet keeps only the corners that matter.
const simplifyOutline = (pts, tolFt = 2.5) => {
  if (!Array.isArray(pts) || pts.length <= 4) return pts;
  const k = Math.PI / 180, R = 6378137 * 3.28084, la0 = pts[0][0], ln0 = pts[0][1];
  const xy = pts.map(([la, ln]) => [(ln - ln0) * k * R * Math.cos(la0 * k), (la - la0) * k * R]);
  const dseg = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const tt = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - (a[0] + tt * dx), p[1] - (a[1] + tt * dy));
  };
  const keep = new Array(pts.length).fill(false);
  const dp = (i, j) => {
    let mx = 0, mi = -1;
    for (let x = i + 1; x < j; x++) { const d = dseg(xy[x], xy[i], xy[j]); if (d > mx) { mx = d; mi = x; } }
    if (mx > tolFt) { dp(i, mi); dp(mi, j); } else { keep[i] = keep[j] = true; }
  };
  // closed ring: anchor at point 0 and the farthest point, simplify both arcs
  let far = 0, fd = 0;
  for (let i = 1; i < xy.length; i++) { const d = Math.hypot(xy[i][0] - xy[0][0], xy[i][1] - xy[0][1]); if (d > fd) { fd = d; far = i; } }
  keep[0] = keep[far] = keep[pts.length - 1] = true;
  dp(0, far); dp(far, pts.length - 1);
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : pts;
};
const zoomForBbox = (b) => {
  const [s, w, n, e] = b;
  const ctr = (s + n) / 2;
  const span = Math.max(n - s, (e - w) * Math.cos((ctr * Math.PI) / 180), 0.00005) * 2.2;
  return Math.min(Math.max(Math.floor(Math.log2((360 * (640 / 256)) / span)), 17), 21);
};

const mockLookup = (addr) => new Promise((resolve) => {
  setTimeout(() => {
    const known = MOCK_PROPERTIES.find(p => p.addr.toLowerCase() === addr.toLowerCase());
    if (known) return resolve(known.noData ? null : known);
    const h = hashAddr(addr.toLowerCase());
    const stories = h % 5 === 0 ? 2 : 1;
    const sqft = 1100 + (h % 1900);
    const pitch = ["4", "5", "6", "8"][h % 4];
    resolve({
      addr, stories, sqft, pitch,
      beds: 2 + (h % 3), baths: 1 + (h % 3 === 0 ? 1 : 0),
      year: 1975 + (h % 50), segments: 2 + (h % 7),
      roofArea: Math.round((sqft / stories) * PITCH_FACTORS[pitch] * 1.12),
      // Deterministic coords (RGV area) so the offline demo can open the trace
      // tool. Real lookups override these with actual satellite coordinates.
      lat: 26.3796 + ((h % 200) - 100) / 8000,
      lng: -98.8203 + ((h % 160) - 80) / 8000,
    });
  }, 2600);
});

/* ─── Shared UI ─── */
const Btn = ({ children, onClick, color = C.orange, textColor = "#fff", style = {}, disabled }) => (
  <button onClick={onClick} disabled={disabled} className="w-full rounded-xl font-bold text-base tracking-wide active:scale-95 transition-transform"
    style={{ background: disabled ? C.line : color, color: disabled ? C.slate : textColor, padding: "16px", fontFamily: "'Barlow Condensed', sans-serif", fontSize: 19, letterSpacing: "0.04em", border: "none", ...style }}>
    {children}
  </button>
);

// Aerial "satellite scan" illustration — a roof traced with a dashed gold
// outline inside camera viewfinder brackets. Pair with .alto-scanbar for motion.
const RoofScanArt = () => (
  <svg viewBox="0 0 400 188" preserveAspectRatio="xMidYMid slice" style={{ display: "block", width: "100%", height: "100%" }}>
    <defs><linearGradient id="rsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1B2A3D" /><stop offset="1" stopColor="#0E1825" /></linearGradient></defs>
    <rect width="400" height="188" fill="url(#rsky)" />
    <g stroke="#2C3E55" strokeWidth="1.5" opacity=".55"><line x1="0" y1="52" x2="400" y2="42" /><line x1="0" y1="142" x2="400" y2="150" /><line x1="118" y1="0" x2="108" y2="188" /><line x1="298" y1="0" x2="308" y2="188" /></g>
    <rect x="22" y="62" width="68" height="46" rx="3" fill="#26333f" opacity=".7" />
    <rect x="320" y="104" width="62" height="48" rx="3" fill="#26333f" opacity=".7" />
    <polygon points="160,56 240,56 250,72 150,72" fill="#4A5868" />
    <polygon points="150,72 250,72 270,112 130,112" fill="#3A4756" />
    <polygon points="130,112 270,112 250,72 150,72 160,56 240,56 250,72" fill="none" stroke="#F8B408" strokeWidth="3" strokeDasharray="7 5" />
    <g stroke="#F8B408" strokeWidth="3" fill="none" strokeLinecap="round"><path d="M16 30 H42 M16 30 V56" /><path d="M384 30 H358 M384 30 V56" /><path d="M16 158 H42 M16 158 V132" /><path d="M384 158 H358 M384 158 V132" /></g>
  </svg>
);

const Field = ({ label, value, onChange, type = "text", suffix, placeholder }) => (
  <label className="block mb-3">
    <span className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.slate }}>{label}</span>
    <div className="flex items-center rounded-xl px-4" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
      <input type={type} inputMode={type === "number" ? "decimal" : undefined} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 py-3 text-lg font-semibold outline-none bg-transparent" style={{ color: C.navy }} />
      {suffix && <span className="text-sm font-semibold" style={{ color: C.slate }}>{suffix}</span>}
    </div>
  </label>
);

const Sel = ({ label, value, onChange, options }) => (
  <label className="block mb-3">
    <span className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.slate }}>{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full py-3 px-4 text-lg font-semibold rounded-xl outline-none"
      style={{ color: C.navy, background: "#fff", border: `1.5px solid ${C.line}`, WebkitAppearance: "none" }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);

const StatusPill = ({ status, t }) => {
  const map = {
    estimate: [C.yellowSoft, C.yellow, t.estimateSt],
    accepted: [C.orangeSoft, C.orange, t.accepted],
    scheduled: [C.orangeSoft, C.orange, t.scheduled],
    inprogress: [C.orangeSoft, C.orange, t.inProgress],
    done: [C.yellowSoft, C.yellow, t.done],
    paid: [C.greenSoft, C.green, t.paid],
  };
  const [bg, fg, label] = map[status] || map.estimate;
  return <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: bg, color: fg }}>{label}</span>;
};

/* Saved contractor profile — survives closing the app */
const savedProfile = (() => {
  try { return JSON.parse(localStorage.getItem("ttp_profile") || "null") || {}; } catch { return {}; }
})();

/* Demo entrance for the sales deck (/?demo=roof): open straight on the
 * quote screen with an ephemeral demo profile — nothing is saved, and a
 * real signed-in user's data is never touched. */
// Android/Chrome fires this once per visit when the app is installable —
// caught here so our own big INSTALAR button can re-trigger the native
// dialog (one tap, no hunting through browser menus). iOS has no such API.
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; });
window.addEventListener("appinstalled", () => { installEvt = null; });
const WANT_ROOF = /[?&]demo=roof/.test(window.location.search);
const WANT_FENCE = /[?&]demo=fence/.test(window.location.search);

/* Private unlimited-demo passcode. The owner opens the app once with ?pass=CODE
 * (matching the server's DEMO_PASS); we remember it so the installed home-screen
 * app keeps measuring without the 6-try trial cap. Public visitors never have it. */
const URL_PASS = (window.location.search.match(/[?&]pass=([^&#]+)/) || [])[1] || "";
if (URL_PASS) { try { localStorage.setItem("alto_demo_pass", decodeURIComponent(URL_PASS)); } catch { /* private mode */ } }
const DEMO_KEY = (() => { try { return localStorage.getItem("alto_demo_pass") || ""; } catch { return ""; } })();

/* The owner's demo link (?demo=roof OR the ?pass=CODE passcode) opens straight
 * into the working app — no signup form, no client-login card — so showing a
 * contractor looks like a finished product. Real signups/clients without a
 * passcode still land on the normal onboarding/login front door. */
const DEMO_ENTER = WANT_ROOF || WANT_FENCE || !!DEMO_KEY;
// A previous demo session leaves its persona in localStorage; an explicit
// ?demo=roof / ?demo=fence link must always win over that stale persona so a
// closer can demo both trades on the same phone.
const DEMO_STALE = /(Techos|Cercas) García \(Demo\)/.test(savedProfile.biz || "");
const DEMO_ROOF = DEMO_ENTER && (!savedProfile.biz || DEMO_STALE);

/* Where the demo-cap screen sends hot prospects: ALTO Pro's sales WhatsApp. */
const SALES_WA = "19568670754";
const demoUsed = () => { try { return parseInt(localStorage.getItem("alto_demo_meas") || "0", 10) || 0; } catch { return 0; } };

/* Push helpers — a VAPID public key is base64url and must be a Uint8Array. */
function urlB64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* ─── Interactive Google Map for tracing ───
 * Loaded at RUNTIME via a <script> tag (never bundled), so if Google Maps fails
 * to load it can't take down app startup the way a bundled map lib could — the
 * caller just falls back to the classic image trace. */
let _gmapsPromise = null;
function loadGoogleMaps(key) {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
  if (_gmapsPromise) return _gmapsPromise;
  _gmapsPromise = new Promise((resolve, reject) => {
    try {
      if (!key) { reject(new Error("no key")); return; }
      const cb = "__altoGmapsReady";
      const to = setTimeout(() => reject(new Error("timeout")), 15000);
      window[cb] = () => { clearTimeout(to); (window.google && window.google.maps) ? resolve(window.google.maps) : reject(new Error("no maps")); };
      const s = document.createElement("script");
      // Load EXACTLY like /mapcheck (which works): no loading=async, no libraries.
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&v=quarterly&callback=" + cb;
      s.async = true;
      s.onerror = () => { clearTimeout(to); reject(new Error("script error")); };
      document.head.appendChild(s);
    } catch (e) { reject(e); }
  });
  _gmapsPromise.catch(() => { _gmapsPromise = null; }); // a failed load shouldn't poison later retries
  return _gmapsPromise;
}

/* Catches any render error inside the map so it can never crash the whole app. */
class TraceErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { try { this.props.onError && this.props.onError(e); } catch (_) { /* noop */ } }
  render() { return this.state.failed ? null : this.props.children; }
}

/* In-app directions overlay — the installed PWA never loses its page.
 * Same maps loader/key as the trace map. Route + drive time from the
 * contractor's location to the job; external Google Maps only via the
 * explicit bottom button (real turn-by-turn for when they actually drive). */
function DriveMap({ dest, lang, mapsKey, onClose }) {
  const elRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | route | pin | failed
  const [info, setInfo] = useState(null); // { dist, dur }
  const [hint, setHint] = useState(null); // small gray bar: no-location / route error (with Google's code, so failures are never silent)
  const es = lang !== "en";
  const S = {
    title: es ? "Cómo llegar" : "Directions",
    noloc: es ? "Activa tu ubicación para ver el tiempo de manejo." : "Turn on location to see drive time.",
    noroute: es ? "Ruta no disponible" : "Route unavailable",
    failed: es ? "No pudimos cargar el mapa — usa el botón de abajo." : "Couldn't load the map — use the button below.",
    open: es ? "Abrir en Google Maps ↗" : "Open in Google Maps ↗",
    loading: es ? "Calculando tu ruta…" : "Finding your route…",
  };
  useEffect(() => {
    let dead = false;
    loadGoogleMaps(mapsKey).then((gmaps) => {
      if (dead || !elRef.current) return;
      try {
      const map = new gmaps.Map(elRef.current, {
        center: Number.isFinite(+dest.lat) && dest.lat != null ? { lat: +dest.lat, lng: +dest.lng } : { lat: 26.2, lng: -98.2 },
        zoom: 13, disableDefaultUI: true, zoomControl: true, clickableIcons: false,
      });
      // The address is marked and zoomed FIRST, deterministically — the
      // route (if the browser gives us a location and the key allows
      // Directions) draws on top afterwards. Never a state-wide mystery map.
      const destLL = Number.isFinite(+dest.lat) && Number.isFinite(+dest.lng) && dest.lat != null ? { lat: +dest.lat, lng: +dest.lng } : null;
      const withDest = (cb) => {
        if (destLL) { cb(destLL); return; }
        new gmaps.Geocoder().geocode({ address: String(dest.addr || "") }, (rs, ok) => {
          if (dead) return;
          if (ok === "OK" && rs && rs[0]) cb(rs[0].geometry.location);
          else setStatus("failed");
        });
      };
      withDest((destPos) => {
        if (dead) return;
        new gmaps.Marker({ map, position: destPos });
        map.setOptions({ center: destPos, zoom: 16 });
        setStatus("pin");
        if (!navigator.geolocation) { setHint(S.noloc); return; }
        navigator.geolocation.getCurrentPosition((pos) => {
          if (dead) return;
          const origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          // The route comes from OUR server (Routes API): Google retired the
          // browser DirectionsService for new projects — it answers
          // REQUEST_DENIED regardless of what the key allows.
          const dl = typeof destPos.lat === "function" ? { lat: destPos.lat(), lng: destPos.lng() } : { lat: +destPos.lat, lng: +destPos.lng };
          fetch(`/api/directions?olat=${origin.lat}&olng=${origin.lng}&dlat=${dl.lat}&dlng=${dl.lng}`)
            .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
            .then(({ ok, j }) => {
              if (dead) return;
              if (ok && j.path && j.path.length > 1) {
                new gmaps.Polyline({ map, path: j.path, strokeColor: "#1B6FB8", strokeOpacity: 0.9, strokeWeight: 5 });
                new gmaps.Marker({ map, position: origin, icon: { path: gmaps.SymbolPath.CIRCLE, scale: 7, fillColor: "#1B6FB8", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 } });
                const b = new gmaps.LatLngBounds();
                j.path.forEach((p) => b.extend(p));
                b.extend(origin); b.extend(dl);
                map.fitBounds(b, 48);
                setInfo({ dist: j.distanceText, dur: j.durationText });
                setStatus("route");
              }
              // route failed → the pinned, zoomed address stays; SAY why
              else setHint(S.noroute + (j && j.error ? " (" + j.error + ")" : ""));
            })
            .catch(() => { if (!dead) setHint(S.noroute); });
        }, () => { if (!dead) setHint(S.noloc); }, { enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 });
      });
      } catch (e) { if (!dead) setStatus("failed"); }
    }).catch(() => { if (!dead) setStatus("failed"); });
    return () => { dead = true; };
  }, []);
  const q = encodeURIComponent(String(dest.addr || "").trim() || (dest.lat != null ? `${dest.lat},${dest.lng}` : ""));
  const openExternal = () => {
    if (/iphone|ipad|ipod/i.test(navigator.userAgent || "")) window.location.href = "maps://maps.apple.com/?daddr=" + q + "&dirflg=d";
    else if (/android/i.test(navigator.userAgent || "")) window.location.href = "geo:0,0?q=" + q;
    else window.open("https://www.google.com/maps/dir/?api=1&destination=" + q, "_blank");
  };
  return (
    <div className="absolute inset-0 flex flex-col" data-drivemap="1" style={{ zIndex: 9998, background: "#fff" }}>
      <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: "1.5px solid #E6E8EC", background: "#fff" }}>
        <button onClick={onClose} aria-label="back" className="rounded-full shrink-0 flex items-center justify-center active:scale-90 transition-transform"
          style={{ width: 42, height: 42, background: "#fff", border: "1.5px solid #E6E8EC", color: "#101B30", fontSize: 24, fontWeight: 800, lineHeight: 1, cursor: "pointer" }}>‹</button>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold truncate" style={{ color: "#101B30", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20, lineHeight: 1.1 }}>🗺️ {S.title}</p>
          <p className="text-xs font-semibold truncate" style={{ color: "#5A6478" }}>{String(dest.addr || "")}</p>
        </div>
        {info && (
          <span className="shrink-0 rounded-full px-3 py-1.5 text-sm font-extrabold" style={{ background: "#101B30", color: "#fff" }}>
            🚗 {info.dur}{info.dist ? ` · ${info.dist}` : ""}
          </span>
        )}
      </div>
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <div ref={elRef} className="absolute inset-0" />
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "#F4F6FA" }}>
            <span className="text-sm font-bold" style={{ color: "#5A6478" }}>🛰️ {S.loading}</span>
          </div>
        )}
        {status === "failed" && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center" style={{ background: "#F4F6FA" }}>
            <span className="text-sm font-bold" style={{ color: "#5A6478" }}>{S.failed}</span>
          </div>
        )}
        {hint && status !== "failed" && (
          <div className="absolute left-3 right-3 bottom-3 rounded-xl px-3 py-2 text-xs font-bold text-center" style={{ background: "rgba(16,27,48,.85)", color: "#fff" }}>
            📍 {hint}
          </div>
        )}
      </div>
      <div className="px-4 py-3 shrink-0" style={{ borderTop: "1.5px solid #E6E8EC", background: "#fff" }}>
        <button onClick={openExternal} className="w-full rounded-xl py-3 font-extrabold active:scale-95 transition-transform"
          style={{ background: "#F4F6FA", border: "1.5px solid #E6E8EC", color: "#101B30", cursor: "pointer", fontSize: 14 }}>
          {S.open}
        </button>
      </div>
    </div>
  );
}

/* The real Google satellite map. Corners are big draggable orange markers
 * (Google's built-in `editable` handles are ~11px — impossible on a phone).
 * Tap a corner to select it, 🗑 deletes it; tap a ＋ on an edge to add a
 * corner there; extra roof sections are separate polygons. */
function GoogleMapTrace({ base, mapsKey, lang, t, pitchFactor, pitch, onPitchChange, onApply, onFallback }) {
  const hasOutline = Array.isArray(base.outline) && base.outline.length >= 3;
  const mapEl = useRef(null);
  const g = useRef(null); // { gmaps, map, path, markers, mids, done: [{pts, polygon}], helpers }
  const [areaFt, setAreaFt] = useState(0);
  const [loading, setLoading] = useState(true);
  // Pre-outlined roof → start in "adjust" (drag corners, taps don't add a stray
  // point). Blank map → start in "add" so the contractor can place corners.
  const [addMode, setAddMode] = useState(!hasOutline);
  const [selIdx, setSelIdx] = useState(null);
  const [ptCount, setPtCount] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const addModeRef = useRef(addMode);
  addModeRef.current = addMode;
  const selRef = useRef(selIdx);
  selRef.current = selIdx;
  useEffect(() => {
    let dead = false;
    window.gm_authFailure = () => { if (!dead) onFallback("Google rechazó la clave (revisa Maps JavaScript API + restricción del sitio)"); }; // bad/unauthorized key
    loadGoogleMaps(mapsKey).then((gmaps) => {
      if (dead || !mapEl.current) return;
      const map = new gmaps.Map(mapEl.current, {
        center: { lat: base.lat, lng: base.lng }, zoom: Math.min(base.zoom || 20, 21),
        mapTypeId: "satellite", tilt: 0, maxZoom: 22, gestureHandling: "greedy",
        disableDefaultUI: true, zoomControl: true, clickableIcons: false,
      });
      // Build the path explicitly so it always exists — an empty `paths: []`
      // Polygon returns an undefined getPath() on real devices, and attaching
      // listeners to it throws "undefined is not an object (a.__e3_)".
      const path = new gmaps.MVCArray();
      new gmaps.Polygon({ map, paths: path, clickable: false, strokeColor: C.orange, strokeWeight: 5, fillColor: C.orange, fillOpacity: 0.2 });
      const S = (g.current = { gmaps, map, path, markers: [], mids: [], done: [] });
      // Finger-sized corner dots (48px hit target) — the whole point of this map.
      const svgIcon = (svg, size) => ({
        url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
        scaledSize: new gmaps.Size(size, size), anchor: new gmaps.Point(size / 2, size / 2),
      });
      // Icon canvas = touch target (stays finger-sized). The dot itself is a
      // RING with a see-through center — the roof corner stays visible inside
      // the hole, so you can tell the dot is exactly on the corner.
      const dotIcon = (sel) => svgIcon(
        `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">`
        + `<circle cx="24" cy="24" r="${sel ? 13 : 9}" fill="none" stroke="#fff" stroke-width="${sel ? 7 : 6}"/>`
        + `<circle cx="24" cy="24" r="${sel ? 13 : 9}" fill="${sel ? "rgba(255,255,255,.25)" : "none"}" stroke="${C.orange}" stroke-width="${sel ? 4 : 3}"/>`
        + `<circle cx="24" cy="24" r="1.6" fill="${C.orange}"/>`
        + `</svg>`, 48);
      const midIcon = svgIcon(
        `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="9.5" fill="rgba(255,255,255,.92)" stroke="${C.orange}" stroke-width="2.5"/><text x="20" y="25" text-anchor="middle" font-size="16" font-weight="800" fill="${C.orange}">+</text></svg>`, 40);
      const curPts = () => {
        const pts = [];
        for (let i = 0; i < path.getLength(); i++) { const p = path.getAt(i); pts.push([p.lat(), p.lng()]); }
        return pts;
      };
      const totalArea = () => {
        let a = S.done.reduce((s, d) => s + traceAreaSqft(d.pts), 0);
        const pts = curPts();
        if (pts.length >= 3) a += traceAreaSqft(pts);
        setAreaFt(Math.round(a));
        setPtCount(path.getLength());
      };
      const select = (i) => { setSelIdx(i); S.markers.forEach((m, j) => m.setIcon(dotIcon(j === i))); };
      const refreshMids = () => {
        S.mids.forEach((m) => m.setMap(null));
        S.mids = [];
        const n = path.getLength();
        if (n < 2) return;
        // Only offer a ＋ on edges long enough to read at this zoom — on a
        // busy roof zoomed out, a ＋ per edge buried the shape under dots.
        const z = (map.getZoom && map.getZoom()) || base.zoom || 20;
        const kR = Math.PI / 180, RE = 6378137;
        const edges = n === 2 ? 1 : n; // open line has 1 edge; polygon closes
        for (let i = 0; i < edges; i++) {
          const a = path.getAt(i), b = path.getAt((i + 1) % n);
          const mPerPx = (156543.03392 * Math.cos(a.lat() * kR)) / Math.pow(2, z);
          const edgeM = Math.hypot((b.lng() - a.lng()) * kR * RE * Math.cos(a.lat() * kR), (b.lat() - a.lat()) * kR * RE);
          if (edgeM / mPerPx < 70) continue; // shorter than ~70px on screen → skip
          const m = new gmaps.Marker({
            map, position: { lat: (a.lat() + b.lat()) / 2, lng: (a.lng() + b.lng()) / 2 },
            icon: midIcon, zIndex: 5, optimized: false,
          });
          const at = i + 1; // between i and i+1 (works for the closing edge too: append at end)
          m.addListener("click", () => { path.insertAt(at, m.getPosition()); syncAll(); select(at); });
          S.mids.push(m);
        }
      };
      const makeMarker = (i) => {
        const m = new gmaps.Marker({
          map, position: path.getAt(i), draggable: true, crossOnDrag: false,
          icon: dotIcon(false), zIndex: 10, optimized: false,
        });
        m.addListener("click", () => select(S.markers.indexOf(m)));
        m.addListener("dragstart", () => select(S.markers.indexOf(m)));
        m.addListener("drag", () => { const idx = S.markers.indexOf(m); if (idx >= 0) { path.setAt(idx, m.getPosition()); totalArea(); } });
        m.addListener("dragend", refreshMids);
        return m;
      };
      const syncAll = () => {
        S.markers.forEach((m) => m.setMap(null));
        S.markers = [];
        for (let i = 0; i < path.getLength(); i++) S.markers.push(makeMarker(i));
        refreshMids();
        totalArea();
      };
      // Close the active shape into a static section (tap it later to re-edit).
      const closeCurrent = () => {
        const pts = curPts();
        if (pts.length < 3) return false;
        const polygon = new gmaps.Polygon({
          map, paths: pts.map(([la, ln]) => ({ lat: la, lng: ln })),
          strokeColor: C.orange, strokeWeight: 4, fillColor: C.orange, fillOpacity: 0.3,
        });
        const entry = { pts, polygon };
        polygon.addListener("click", () => reopen(entry));
        S.done.push(entry);
        setDoneCount(S.done.length);
        path.clear();
        setSelIdx(null);
        syncAll();
        return true;
      };
      const reopen = (entry) => {
        closeCurrent(); // whatever is being edited gets kept, not lost
        entry.polygon.setMap(null);
        S.done = S.done.filter((d) => d !== entry);
        setDoneCount(S.done.length);
        path.clear();
        entry.pts.forEach(([la, ln]) => path.push(new gmaps.LatLng(la, ln)));
        setSelIdx(null);
        syncAll();
        setAddMode(false);
      };
      S.syncAll = syncAll; S.select = select; S.totalArea = totalArea; S.curPts = curPts; S.closeCurrent = closeCurrent;
      // Tap the map: add a corner in "add" mode, deselect in "adjust" mode.
      map.addListener("click", (e) => {
        if (addModeRef.current) { path.push(e.latLng); syncAll(); }
        else select(null);
      });
      // ＋ dots come and go with zoom level
      map.addListener("zoom_changed", refreshMids);
      // Start from the roof the app already detected — simplified to its real
      // corners, so the contractor nudges 6 dots instead of untangling 14.
      if (hasOutline) {
        simplifyOutline(base.outline).forEach(([la, ln]) => { if (Number.isFinite(la) && Number.isFinite(ln)) path.push(new gmaps.LatLng(la, ln)); });
        try { const b = new gmaps.LatLngBounds(); for (let i = 0; i < path.getLength(); i++) b.extend(path.getAt(i)); map.fitBounds(b, 48); } catch (_) { /* keep default center */ }
        syncAll();
      }
      // Genuine key/API failures fire gm_authFailure (handled above) and drop to
      // the classic map; we do NOT bail on a slow first tile load, which on real
      // phones can take longer than expected and was causing false fallbacks.
      gmaps.event.addListenerOnce(map, "tilesloaded", () => { if (!dead) setLoading(false); });
      setLoading(false);
    }).catch((e) => { if (!dead) onFallback("no cargó: " + ((e && e.message) || "desconocido")); });
    return () => { dead = true; };
  }, []);
  const undo = () => {
    const S = g.current; if (!S) return;
    const n = S.path.getLength();
    if (n) { S.path.removeAt(n - 1); setSelIdx(null); S.syncAll(); }
  };
  const delCorner = () => {
    const S = g.current; if (!S || selRef.current == null) return;
    if (selRef.current < S.path.getLength()) { S.path.removeAt(selRef.current); setSelIdx(null); S.syncAll(); }
  };
  const clearAll = () => {
    const S = g.current; if (!S) return;
    S.done.forEach((d) => d.polygon.setMap(null));
    S.done = [];
    setDoneCount(0);
    S.path.clear();
    setSelIdx(null);
    S.syncAll();
    setAddMode(true);
  };
  const otherSection = () => {
    const S = g.current; if (!S) return;
    if (S.closeCurrent()) setAddMode(true);
  };
  const apply = () => {
    const S = g.current; if (!S) return;
    const secs = S.done.map((d) => d.pts);
    const cur = S.curPts();
    if (cur.length >= 3) secs.push(cur);
    if (secs.length) onApply(secs);
  };
  const squares = Math.max(0, Math.ceil((areaFt * (pitchFactor || 1.118)) / 100));
  return (
    <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
      <div className="flex gap-2 mb-2">
        <button onClick={() => setAddMode(false)} className="flex-1 rounded-xl px-2 py-2 active:scale-95 transition-transform"
          style={{ background: !addMode ? C.orange : "#fff", border: `2px solid ${!addMode ? C.orange : C.line}`, color: !addMode ? "#fff" : C.navy }}>
          <span className="block font-extrabold text-sm">✋ {lang === "es" ? "Ajustar esquinas" : "Adjust corners"}</span>
        </button>
        <button onClick={() => setAddMode(true)} className="flex-1 rounded-xl px-2 py-2 active:scale-95 transition-transform"
          style={{ background: addMode ? C.orange : "#fff", border: `2px solid ${addMode ? C.orange : C.line}`, color: addMode ? "#fff" : C.navy }}>
          <span className="block font-extrabold text-sm">➕ {lang === "es" ? "Agregar esquina" : "Add corner"}</span>
        </button>
      </div>
      <div className="rounded-xl px-3 py-1.5 mb-2 flex items-center gap-2" style={{ background: C.orangeSoft, border: `1.5px solid ${C.orange}` }}>
        <span className="text-sm">{addMode ? "👆" : "✋"}</span>
        <span className="font-bold" style={{ color: "#8A5A00", lineHeight: 1.3, fontSize: 11 }}>
          {addMode ? t.gmapAddHint : t.gmapAdjustHint}
        </span>
      </div>
      {/* The map is the tool — give it the phone. Everything else scrolls below. */}
      <div className="relative rounded-2xl overflow-hidden mb-1" style={{ width: "100%", height: "min(62dvh, 560px)", minHeight: 340, background: C.navyDeep }}>
        <div ref={mapEl} className="absolute inset-0 w-full h-full" />
        {loading && <div className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: "#9DA8C4" }}>…</div>}
        <div className="absolute left-2 top-2 rounded-full px-3.5 py-1.5 font-extrabold flex items-baseline gap-1"
          style={{ background: C.orange, color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,.3)", pointerEvents: "none" }}>
          <span style={{ fontSize: 20, lineHeight: 1 }}>{squares}</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{lang === "es" ? "cuadros" : "squares"}</span>
          {doneCount > 0 && <span style={{ fontSize: 12, fontWeight: 700, opacity: .8 }}>· {doneCount + (ptCount >= 3 ? 1 : 0)} {t.sectionsLbl}</span>}
        </div>
      </div>
      <p className="text-[10px] font-extrabold mb-2 tracking-wider" style={{ color: C.green }}>● {lang === "es" ? "MAPA REAL DE GOOGLE" : "REAL GOOGLE MAP"}</p>
      <div className="flex gap-2 mb-2">
        <button onClick={undo} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy }}>{t.undo}</button>
        <button onClick={delCorner} disabled={selIdx == null}
          className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${selIdx == null ? C.line : C.red}`, color: selIdx == null ? C.slate : C.red }}>{t.delCorner}</button>
        <button onClick={clearAll} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.red }}>{t.clearAll}</button>
      </div>
      <button onClick={otherSection} disabled={ptCount < 3} className="w-full rounded-xl py-2.5 mb-3 text-sm font-bold"
        style={{ background: ptCount >= 3 ? C.orangeSoft : "#fff", border: `1.5px solid ${ptCount >= 3 ? C.orange : C.line}`, color: ptCount >= 3 ? C.orange : C.slate }}>
        {t.otherSection}
      </button>
      <Sel label={t.pitch} value={pitch} onChange={onPitchChange} options={Object.keys(PITCH_FACTORS).map((p) => [p, `${p}/12`])} />
      <div className="rounded-2xl p-4 mb-3 flex items-center justify-between" style={{ background: C.navy }}>
        <p className="text-sm font-semibold" style={{ color: "#9DA8C4" }}>{t.tracedArea}: <span className="font-extrabold text-white">{areaFt.toLocaleString()} sq ft</span></p>
        <div className="text-right shrink-0 pl-3">
          <p className="font-extrabold text-white" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 38, lineHeight: 1 }}>{squares}</p>
          <p className="text-xs font-extrabold tracking-widest" style={{ color: C.orange }}>{lang === "es" ? "CUADROS" : "SQUARES"}</p>
        </div>
      </div>
      <button onClick={apply} disabled={areaFt < 1} className="w-full rounded-2xl py-3.5 font-extrabold active:scale-95 transition-transform mb-1"
        style={{ background: areaFt >= 1 ? C.orange : C.line, color: areaFt >= 1 ? "#fff" : C.slate, border: "none", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19 }}>
        {t.useMeasure}
      </button>
      <button onClick={() => onFallback("manual")} className="w-full py-2 text-xs font-bold" style={{ background: "none", border: "none", color: C.slate }}>↩︎ {t.useClassicMap}</button>
    </div>
  );
}

/* ─── Main App ─── */
export default function TradeTechPro() {
  const [lang, setLang] = useState(savedProfile.lang || "es");
  const t = TR[lang];
  // Cloud accounts open on a branded splash until /api/me answers — otherwise
  // the trade-picker/onboarding flashes for a split second on every launch.
  const [screen, setScreen] = useState(() => {
    if (DEMO_ENTER) return "home";
    try {
      if (/[#&]session=/.test(window.location.hash || "") || /[?&]s=/.test(window.location.search || "") || localStorage.getItem("alto_session")) return "boot";
    } catch { /* private mode */ }
    return savedProfile.biz ? (savedProfile.trade ? "home" : "trade") : "onboard";
  });
  const [trade, setTrade] = useState(WANT_FENCE ? "fence" : WANT_ROOF ? "roofing" : (savedProfile.trade || "roofing"));
  // Desktop mode (≥1024px): the SAME screens inside an office shell — sidebar
  // with the brand + tabs instead of the bottom bar, wider content. Below the
  // breakpoint nothing changes: the phone app stays exactly as it is.
  const [isDesk, setIsDesk] = useState(() => window.matchMedia?.("(min-width: 1024px)").matches || false);
  const [listQ, setListQ] = useState(""); // desktop-only list search (Trabajos/Clientes)
  useEffect(() => { setListQ(""); }, [screen]);
  const [sortJ, setSortJ] = useState("date"); // desktop Trabajos sort
  const [sortC, setSortC] = useState("az"); // desktop Clientes sort
  // Desktop send screen shows the REAL estimate document beside the actions.
  const [sendPrev, setSendPrev] = useState(null);
  useEffect(() => {
    if (!(isDesk && screen === "send" && activeJob)) { setSendPrev(null); return; }
    let dead = false;
    (async () => {
      try { const id = await ensureLogoId(); if (!dead) setSendPrev(buildShareUrl(activeJob, "est", id)); }
      catch { if (!dead) setSendPrev(buildShareUrl(activeJob, "est")); }
    })();
    return () => { dead = true; };
  }, [screen, isDesk]);
  useEffect(() => {
    const mq = window.matchMedia?.("(min-width: 1024px)");
    if (!mq) return;
    const on = (e) => setIsDesk(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const [userName, setUserName] = useState(savedProfile.name || (DEMO_ROOF ? "José" : ""));
  // Wizard-completed flag. Must live in the CLOUD profile too — localStorage
  // alone made every fresh load of a cloud account re-run onboarding.
  const [setupDone, setSetupDone] = useState(!!savedProfile.setupDone);
  const [bizName, setBizName] = useState(DEMO_ROOF ? (WANT_FENCE ? "Cercas García (Demo)" : "Techos García (Demo)") : (savedProfile.biz || ""));
  const [userPhone, setUserPhone] = useState(savedProfile.phone || "");
  const [logo, setLogo] = useState(savedProfile.logo || null);
  const [bizEmail, setBizEmail] = useState(savedProfile.email || "");
  const [license, setLicense] = useState(savedProfile.license || "");
  const [zelle, setZelle] = useState(savedProfile.zelle || "");
  // Proposal extras (editable in Settings): scope-of-work list + optional warranty.
  const [scope, setScope] = useState(savedProfile.scope != null ? savedProfile.scope : (savedProfile.lang === "en" ? DEFAULT_SCOPE_EN : DEFAULT_SCOPE_ES));
  const [warrantyOn, setWarrantyOn] = useState(!!savedProfile.warrantyOn);
  const [warrantyText, setWarrantyText] = useState(savedProfile.warrantyText || "");
  const [myPrices, setMyPrices] = useState(savedProfile.prices || {});
  // Fence products catalog: null = the 5 defaults; once edited it becomes the
  // contractor's real list [{id, name, price, panelW, on}] — persisted like prices
  const [fenceProducts, setFenceProducts] = useState(savedProfile.fenceProducts || null);
  const [fProdEdit, setFProdEdit] = useState(false);
  const [fMat, setFMat] = useState(null); // live HD material prices (peek sheet)
  const [fMatOpen, setFMatOpen] = useState(false); // main-screen accordion
  const [fMatZoom, setFMatZoom] = useState(null); // tapped material (big photo)
  const [fTake, setFTake] = useState({}); // takeoff overrides {k: {on, qty, price}}
  const [fMatAll, setFMatAll] = useState(false); // full price list toggle (under the takeoff)
  // Materials list + per-quote overrides — declared before the save/load effects
  // that depend on them (otherwise they'd be referenced before initialization).
  const initMats = Array.isArray(savedProfile.materials) && savedProfile.materials.length ? savedProfile.materials : DEFAULT_MATERIALS;
  const [myMaterials, setMyMaterials] = useState(initMats);
  const [matName, setMatName] = useState(initMats[0].n);
  const [ov, setOv] = useState({});  // per-quote line overrides: {mat,lab,tear,acc}
  const updateMat = (i, k, v) => setMyMaterials((ms) => ms.map((m, j) => j === i ? { ...m, [k]: k === "p" ? (v === "" ? "" : Math.max(0, Math.round(parseFloat(v) || 0))) : v } : m));
  const addMat = () => setMyMaterials((ms) => [...ms, { n: "", p: 0 }]);
  const removeMat = (i) => setMyMaterials((ms) => ms.length > 1 ? ms.filter((_, j) => j !== i) : ms);
  const logoIdRef = useRef(null); // server id for the currently uploaded logo

  // contractor's saved price beats the default
  const priceOf = (k) => (myPrices[k] != null && myPrices[k] !== "" ? Number(myPrices[k]) : MAT_PRICES[k]);
  const zelleNum = zelle || userPhone;

  const saveProfile = (patch) => {
    try {
      const cur = JSON.parse(localStorage.getItem("ttp_profile") || "{}");
      localStorage.setItem("ttp_profile", JSON.stringify({ ...cur, ...patch }));
    } catch { /* private mode */ }
  };

  const onLogoFile = (file) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 240 / img.width, 120 / img.height);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      let data = cv.toDataURL("image/png");
      if (data.length > 120000) data = cv.toDataURL("image/jpeg", 0.82);
      setLogo(data);
      logoIdRef.current = null;
      saveProfile({ logo: data });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };

  // Upload the logo (by content) so shared invoice pages can show it.
  // Re-uploads transparently if the server has restarted since last time.
  const ensureLogoId = async () => {
    if (!logo) return null;
    if (logoIdRef.current) return logoIdRef.current;
    try {
      const r = await fetch("/api/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: logo }),
      });
      if (r.ok) { const j = await r.json(); logoIdRef.current = j.id; return j.id; }
    } catch { /* backend unreachable — share without logo */ }
    return null;
  };
  // Only the local demo (no cloud session) starts with sample customers/jobs.
  // A real account starts empty and is filled by /api/me — otherwise a load
  // failure would leave the fake "María Garza" seed looking like real data.
  const hasSessionAtStart = (() => {
    try {
      return /[#&]session=/.test(window.location.hash || "")
        || /[?&]s=/.test(window.location.search || "")
        || !!localStorage.getItem("alto_session");
    } catch { return false; }
  })();
  const [customers, setCustomers] = useState(hasSessionAtStart ? [] : seedCustomers);
  const [jobs, setJobs] = useState(hasSessionAtStart ? [] : seedJobs);
  const [activeJobId, setActiveJobId] = useState(null);
  const [toast, setToast] = useState(null);
  const [demoCap, setDemoCap] = useState(false); // demo hit its 6-measure cap → conversion screen
  const [pendingEstimate, setPendingEstimate] = useState(null);
  const [newCust, setNewCust] = useState(null);
  const [pickTab, setPickTab] = useState("new");
  const [editJob, setEditJob] = useState(null); // {lines,custId,title,addr} while editing a job
  const leadCustRef = useRef(null); // when converting a lead, the estimate skips the customer picker
  const [demoPass, setDemoPass] = useState("");   // typed on the locked screen
  const [demoErr, setDemoErr] = useState(false);
  const [accountPaused, setAccountPaused] = useState(false);  // client stopped paying
  const [slug, setSlug] = useState("");          // this contractor's public quote-page slug
  const [pushOn, setPushOn] = useState(false);   // lead push notifications enabled
  const [pushBusy, setPushBusy] = useState(false);
  const [obStep, setObStep] = useState(0);       // first-run onboarding wizard step

  /* ── Cloud account (invite link → everything saved on the server) ── */
  const [session, setSession] = useState(() => {
    // From the access-link redirect (#session=...) OR the installed app's
    // personalized start_url (/?s=...). The latter is how the home-screen app
    // logs itself in even though iOS isolates its storage from Safari.
    const m = /[#&]session=([^&]+)/.exec(window.location.hash || "")
      || /[?&]s=([^&#]+)/.exec(window.location.search || "");
    if (m) {
      const tok = decodeURIComponent(m[1]);
      try { localStorage.setItem("alto_session", tok); } catch { /* private mode */ }
      window.history.replaceState(null, "", window.location.pathname);
      return tok;
    }
    try { return localStorage.getItem("alto_session"); } catch { return null; }
  });
  const [cloudReady, setCloudReady] = useState(false);
  const api = (path, opts = {}) => fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
      ...(opts.headers || {}),
    },
  });

  // On startup with a session: load my account and my saved data
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let tries = 0;
    const load = async () => {
      try {
        const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone ? "1" : "0";
        const r = await api("/api/me?standalone=" + standalone);
        if (r.status === 401) {
          try { localStorage.removeItem("alto_session"); } catch { /* ignore */ }
          setSession(null);
          setScreen((s) => (s === "boot" ? (savedProfile.biz ? "home" : "onboard") : s));
          return;
        }
        if (!r.ok) throw new Error("me " + r.status);
        const j = await r.json();
        if (cancelled) return;
        // Locked = stopped paying (paused) OR never paid (pending). The server
        // also enforces this on every billable call; this just shows the lock
        // screen instead of letting a measure fail with a raw error.
        setAccountPaused(j.contractor?.data?.status === "paused" || j.contractor?.data?.payStatus === "pending");
        setTkOn(!!j.contractor?.data?.tkBeta || !!DEMO_KEY);
        if (j.contractor?.slug) setSlug(j.contractor.slug);
        const p = j.contractor?.data?.profile || {};
        setBizName(p.biz || j.contractor.name || "");
        // The closer types the client's name at signup — prefill the wizard's
        // "Tu nombre" with its first word so the greeting is personal from day
        // one. Finished accounts keep whatever they saved (maybe empty).
        const doneAlready = !!p.setupDone || !!(p.biz && Array.isArray(p.materials) && p.materials.length);
        setUserName(p.name || (!doneAlready ? String(j.contractor.name || "").trim().split(/\s+/)[0] : "") || "");
        setUserPhone(p.phone || j.contractor.phone || "");
        if (p.logo) setLogo(p.logo);
        if (p.lang) setLang(p.lang);
        if (p.trade) setTrade(p.trade);
        if (p.email) setBizEmail(p.email);
        if (p.license) setLicense(p.license);
        if (p.zelle) setZelle(p.zelle);
        if (p.scope != null) setScope(p.scope);
        setWarrantyOn(!!p.warrantyOn);
        if (p.warrantyText != null) setWarrantyText(p.warrantyText);
        if (p.prices) setMyPrices(p.prices);
        if (Array.isArray(p.materials) && p.materials.length) { setMyMaterials(p.materials); setMatName(p.materials[0].n); setMatSq(String(p.materials[0].p)); }
        else if (p.trade === "fence") { setMyMaterials(FENCE_MATERIALS); setMatName(FENCE_MATERIALS[0].n); setMatSq(String(FENCE_MATERIALS[0].p)); }
        // Real accounts start clean — no demo data
        setCustomers(j.state?.customers || []);
        setJobs(j.state?.jobs || []);
        // First-run onboarding wizard until they finish (or skip) it; then home.
        // Done = the saved flag, OR a profile that clearly finished setup before
        // the flag existed in the cloud (has a business name + materials).
        const done = !!p.setupDone || !!(p.biz && Array.isArray(p.materials) && p.materials.length);
        if (done) setSetupDone(true);
        if (!WANT_ROOF && !WANT_FENCE) { setObStep(0); setScreen(done ? "home" : "onboard"); }
        setCloudReady(true);
      } catch {
        // Couldn't reach the account (offline / server hiccup). Don't flip
        // cloudReady — the save effect is gated on it, so unloaded local state
        // can't overwrite the server. Retry with backoff so edits made in the
        // meantime aren't stranded forever once the network returns.
        if (cancelled) return;
        // don't strand the splash while offline — local data works meanwhile
        setScreen((s) => (s === "boot" ? (savedProfile.biz ? "home" : "onboard") : s));
        if (tries++ < 6) setTimeout(load, Math.min(30000, 2000 * 2 ** tries));
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Save to the cloud shortly after anything changes
  useEffect(() => {
    if (!session || !cloudReady) return;
    const id = setTimeout(() => {
      api("/api/state", {
        method: "PUT",
        body: JSON.stringify({
          state: { customers, jobs },
          profile: { profile: { name: userName, biz: bizName, phone: userPhone, logo, lang, trade, email: bizEmail, license, zelle, scope, warrantyOn, warrantyText, prices: myPrices, materials: myMaterials, fenceProducts, setupDone } },
        }),
      }).catch(() => { /* offline — retried on next change */ });
    }, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, cloudReady, customers, jobs, userName, bizName, userPhone, logo, lang, trade, bizEmail, license, zelle, scope, warrantyOn, warrantyText, myPrices, myMaterials, fenceProducts, setupDone]);

  /* ── Leads from the website widget ── */
  const [leads, setLeads] = useState(DEMO_ROOF ? seedLeads : []);
  const [leadOpenMonths, setLeadOpenMonths] = useState(null); // null → latest month open
  const [leadOpenId, setLeadOpenId] = useState(null);         // which lead card is expanded
  const [jobOpenMonths, setJobOpenMonths] = useState(null);   // same idea for the jobs list
  const [payOpenMonths, setPayOpenMonths] = useState(null);   // same idea for Cobros' owed-by-month folders
  const [custOpen, setCustOpen] = useState(null);             // customer card expanded to show job history
  const [scopeAiBusy, setScopeAiBusy] = useState(false);      // "improve with AI" in Settings
  const [reqText, setReqText] = useState("");                 // Settings → change-request ticket
  const [reqKind, setReqKind] = useState("any");              // bot | web | queja | any
  const [reqBusy, setReqBusy] = useState(false);
  const [myReqs, setMyReqs] = useState(null);                 // the contractor's ticket history
  const [myReqsOpen, setMyReqsOpen] = useState(false);
  const [setSec, setSetSec] = useState("negocio");            // which Settings section is expanded
  const fetchMyReqs = async () => {
    try { const r = await api("/api/my-requests"); if (r.ok) setMyReqs((await r.json()).tickets || []); } catch { /* offline */ }
  };
  const fetchLeads = async () => {
    if (!session) return;
    try {
      const r = await api("/api/leads");
      if (r.ok) setLeads((await r.json()).leads || []);
    } catch { /* offline */ }
  };
  // refresh when the account loads, when looking at home/leads, and every minute on those screens
  useEffect(() => {
    if (!session || !cloudReady) return;
    if (screen !== "home" && screen !== "leads") return;
    fetchLeads();
    const id = setInterval(fetchLeads, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, cloudReady, screen]);
  const newLeadCount = leads.filter((l) => l.status === "new").length;

  // Sales-deck magic (demo mode only): the deck's website mockup announces a
  // phone number typed into its chat; it appears here as a live lead so the
  // prospect watches their own message land on "their" phone.
  useEffect(() => {
    if (!DEMO_ENTER) return;
    const onMsg = (e) => {
      const d = e.data;
      if (!d || d.alto !== "lead" || !d.phone) return;
      const digits = String(d.phone).replace(/\D/g, "").slice(0, 11);
      if (digits.length < 10) return;
      setLeads((ls) => [{
        id: "demo" + Date.now(), name: String(d.name || "").slice(0, 60), phone: digits, address: "",
        status: "new", created_at: new Date().toISOString(),
        info: d.src === "form" ? { source: "widget" } : { source: "chat", chat: String(d.text || "").slice(0, 200) },
      }, ...ls]);
      showToast(d.src === "form"
        ? (lang === "en" ? "🎉 New lead from your quote tool!" : "🎉 ¡Nuevo lead del cotizador de tu página!")
        : (lang === "en" ? "🎉 New lead from your website chat!" : "🎉 ¡Nuevo lead del chat de tu página!"));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Home-screen install: one-tap native prompt on Android, guided overlay
  // elsewhere (iOS has no install API — Apple only allows the manual way).
  const [instOpen, setInstOpen] = useState(false);
  const [instHide, setInstHide] = useState(() => { try { return localStorage.getItem("alto_inst_hide") === "1"; } catch { return false; } });
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone;
  const isIOSDev = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  const hideInstall = () => { setInstHide(true); try { localStorage.setItem("alto_inst_hide", "1"); } catch { /* private mode */ } };
  const doInstall = async () => {
    if (installEvt) {
      const evt = installEvt;
      installEvt = null;
      evt.prompt();
      const ch = await evt.userChoice.catch(() => null);
      if (ch && ch.outcome === "accepted") { hideInstall(); showToast("📲 ✓"); }
      else installEvt = evt;
      return;
    }
    setInstOpen(true);
  };

  const markLead = (id, status) => {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    api(`/api/leads/${id}`, { method: "POST", body: JSON.stringify({ status }) }).catch(() => { /* retried implicitly on next fetch */ });
  };

  // Convert a lead into a quote: reuse/create the customer, remember it so the
  // estimate skips the picker, mark the lead "interested", and jump straight to
  // measuring the lead's address. Closes lead → estimate in one tap.
  const convertLead = (lead) => {
    const digits = (x) => String(x || "").replace(/\D/g, "").replace(/^1/, "");
    let cust = customers.find((c) => (lead.phone && digits(c.phone) === digits(lead.phone)) || (lead.name && c.name.toLowerCase() === String(lead.name).toLowerCase()));
    if (!cust) {
      cust = { id: Date.now(), name: lead.name || "—", phone: lead.phone || "", addr: lead.address || "" };
      setCustomers((cs) => [...cs, cust]);
    }
    leadCustRef.current = cust.id;
    if (lead.status === "new") markLead(lead.id, "interested");
    setLookup(null); setTakeoff(null);
    if (lead.address) { setAddrQ(lead.address); setPlaceSugs(null); setScreen("roofAddress"); startLookup(lead.address); }
    else { setMSq(""); setOv({}); setScreen("calc"); }
  };

  // Personalize the home-screen install: point the manifest's start_url at this
  // client's session so the installed app (which has its own storage on iOS)
  // opens already logged in — regardless of the "Open as Web App" toggle.
  useEffect(() => {
    if (!session) return;
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.setAttribute("href", `/manifest.webmanifest?s=${encodeURIComponent(session)}`);
  }, [session]);

  /* ── Lead push notifications (phone buzzes even with the app closed) ── */
  // Reflect whether this device is already subscribed — and SELF-HEAL: if the
  // phone holds a subscription, re-register it with the server on every open.
  // Re-registering is idempotent (deduped by endpoint), and it repairs the
  // silent failure mode where the phone shows "activados" but the server's
  // copy was lost or never saved — the #1 cause of "no me llegó el aviso".
  useEffect(() => {
    if (!session) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setPushOn(!!sub);
        if (sub) api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub }) }).catch(() => {});
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  const enablePush = async () => {
    if (pushBusy) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      showToast(t.pushUnsupported); return;
    }
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone;
    if (isIOS && !standalone) { showToast(t.pushInstallFirst); return; }
    setPushBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { showToast(t.pushDenied); setPushBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await fetch("/api/push/key").then((r) => r.json()).catch(() => ({}));
      if (!key) { showToast(t.pushErr); setPushBusy(false); return; }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(key),
      });
      const r = await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub }) });
      if (!r.ok) throw new Error("save failed");
      setPushOn(true);
      showToast(t.pushOnLabel);
    } catch {
      showToast(t.pushErr);
    }
    setPushBusy(false);
  };
  // Turn alerts back off on THIS device: drop the server's copy first, then
  // release the browser subscription. Other devices on the account keep theirs.
  const disablePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe();
      }
      setPushOn(false);
      showToast(t.pushOffLabel);
    } catch {
      showToast(t.pushErr);
    }
    setPushBusy(false);
  };

  // calculator state
  const [L, setL] = useState("30"), [W, setW] = useState("20"), [TH, setTH] = useState("4"), [waste, setWaste] = useState("10");
  const [ppy, setPpy] = useState("160"), [laborRate, setLaborRate] = useState("2.50");

  // roofing calculator state
  const [fp, setFp] = useState("1800"), [stories, setStories] = useState("1"), [pitch, setPitch] = useState("6");
  const [roofMat, setRoofMat] = useState("arch"), [tearOff, setTearOff] = useState(true), [layers, setLayers] = useState("1");
  const [roofWaste, setRoofWaste] = useState(10); // material waste %, auto-suggested per roof
  const [matSq, setMatSq] = useState(String(initMats[0].p)),
    [labSq, setLabSq] = useState(String(savedProfile.prices?.labor ?? 150)),
    [tearSq, setTearSq] = useState(String(savedProfile.prices?.tear ?? 50));
  // Keep the live estimator's labor/tear rates in step with Settings — editing
  // a price and leaving via the bottom nav (not the SAVE button) used to keep
  // quoting at the old rate until reload. Only follows Settings when NOT
  // mid-edit on the quote screen (editPrices), so an in-quote tweak isn't stomped.
  useEffect(() => {
    if (editPrices) return;
    if (myPrices.labor != null && myPrices.labor !== "") setLabSq(String(myPrices.labor));
    if (myPrices.tear != null && myPrices.tear !== "") setTearSq(String(myPrices.tear));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPrices.labor, myPrices.tear]);

  // address lookup state (demo data for now)
  const [addrQ, setAddrQ] = useState("");
  const [measuring, setMeasuring] = useState(false);
  const [measurePhase, setMeasurePhase] = useState(0);
  const [measureCoords, setMeasureCoords] = useState(null); // real image during measuring when we know coords (GPS)
  const [pickBase, setPickBase] = useState(null); // "wrong house" picker: {lat, lng, zoom, addr}
  const [payForm, setPayForm] = useState(null);   // "record payment" mini-form on the invoice
  const [viewPic, setViewPic] = useState(null);   // full-screen job photo viewer
  // Job photos: real camera/gallery capture, compressed hard so a job with 6
  // photos still syncs through /api/state without blowing up the payload.
  const addJobPhoto = (jobId, file) => {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 900 / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const data = cv.toDataURL("image/jpeg", 0.62);
      setJobs((js) => js.map((j) => j.id === jobId ? { ...j, pics: [...(j.pics || []), data].slice(0, 6), photos: Math.min(6, (j.pics || []).length + 1) } : j));
      showToast("📷 ✓");
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  };
  const [takeoff, setTakeoff] = useState(null);   // opt-in linear takeoff (beta) for the current lookup
  const [tkBusy, setTkBusy] = useState(false);
  // Internal beta: hidden unless the admin flips the account's switch (or the
  // owner's demo pass is present). A misaligned takeoff would make contractors
  // distrust the measurement itself — nobody sees it until it's earned.
  const [tkOn, setTkOn] = useState(!!DEMO_KEY);
  const [lookup, setLookup] = useState(null);
  const [editPrices, setEditPrices] = useState(false); // inline price-editing on the quote screen
  useEffect(() => { setOv({}); setEditPrices(false); }, [lookup]);  // fresh quote (clear edits) on each new measurement
  const [streetMeta, setStreetMeta] = useState(null); // {ok, date} for the front-of-house photo
  const [zoomPhoto, setZoomPhoto] = useState(null);   // url shown in the tap-to-enlarge lightbox
  const [driveDest, setDriveDest] = useState(null);   // { addr, lat, lng } → in-app directions overlay
  // When a new measurement lands, ask the server if there's a street photo (and from when).
  useEffect(() => {
    setStreetMeta(null);
    if (!lookup || lookup.lat == null) return;
    let live = true;
    fetch(`/api/streetview/info?lat=${lookup.lat}&lng=${lookup.lng}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j) setStreetMeta(j); })
      .catch(() => {});
    return () => { live = false; };
  }, [lookup]);
  const [mSq, setMSq] = useState("");
  const [placeSugs, setPlaceSugs] = useState(null); // null = use built-in list
  const placesSeq = useRef(0);

  // roof tracing state
  const [traceBase, setTraceBase] = useState(null); // {lat, lng, zoom, addr}
  const [traceSecs, setTraceSecs] = useState([]);   // completed polygons (natural px)
  const [traceCur, setTraceCur] = useState([]);     // polygon being drawn
  const [mapsKey, setMapsKey] = useState(null);     // browser key for the interactive Google map
  const [gmapOff, setGmapOff] = useState(false);    // true → use the classic image trace (fallback)
  const [gmapErr, setGmapErr] = useState("");       // why the real map fell back (for diagnosis)
  useEffect(() => { fetch("/api/maps-config").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.key) setMapsKey(j.key); }).catch(() => {}); }, []);
  const [traceNoImg, setTraceNoImg] = useState(false);
  const [dragOff, setDragOff] = useState([0, 0]); // live pan offset in CSS px
  // Two-finger pan + pinch-zoom (Google-Maps feel), shared by the roof-trace
  // and fence-draw maps. Purely ADDITIVE: one finger still draws/edits exactly
  // as before; the SECOND finger switches the gesture to move-the-map. The
  // whole wrapper (satellite image + the drawn SVG) rides one live CSS
  // transform so the drawing stays locked to the world, then we recenter the
  // base (and snap zoom) on release. Desktop gets scroll-wheel zoom.
  const mapPtrs = useRef(new Map());   // active pointerId → {x,y}
  const mapGest = useRef(null);        // live move gesture {rect,base0,mid0,dist0,last}
  const panLatch = useRef(false);      // after a 2-finger gesture, ignore leftover fingers until all lift
  const [mapXform, setMapXform] = useState(null); // {tx,ty,scale,ox,oy} live transform
  // ✋ Mover: while ON, ONE finger pans the map exactly like Google Maps and
  // taps never draw — the visible escape hatch for "I just want to move it".
  // Two-finger pan/pinch works in BOTH modes. Resets to draw on screen change.
  const [mapPan, setMapPan] = useState(false);
  useEffect(() => { setMapPan(false); }, [screen]);
  // Builds the container's pointer/wheel handlers around a map's existing
  // single-finger handlers. `single` = {down,move,up}; `cancel` reverts any
  // provisional single-finger action when the 2nd finger lands.
  const makeMapHandlers = (single, base, setBase, W, H, cancel, ZMIN = 16, ZMAX = 21) => ({
    onWheel: (e) => {
      e.preventDefault();
      const z = Math.min(ZMAX, Math.max(ZMIN, base.zoom + (e.deltaY < 0 ? 1 : -1)));
      if (z !== base.zoom) setBase({ ...base, zoom: z });
    },
    onPointerDown: (e) => {
      mapPtrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const n = mapPtrs.current.size;
      // ✋ mode: the 1st finger already moves the map; draw mode needs the 2nd
      if (mapPan ? n >= 1 : n === 2) {
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) { /* synthetic/edge pointer */ }
        const pts = [...mapPtrs.current.values()];
        const a = pts[0], b = pts[1];
        const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: a.x, y: a.y };
        const dist = b ? (Math.hypot(a.x - b.x, a.y - b.y) || 1) : 1;
        const g = mapGest.current;
        if (g && g.last) {
          // a finger JOINED an active pan — re-anchor so the map doesn't jump
          g.mid0 = { x: mid.x - g.last.tx, y: mid.y - g.last.ty };
          g.dist0 = dist / (g.last.scale || 1);
        } else {
          cancel && cancel();
          mapGest.current = { rect: e.currentTarget.getBoundingClientRect(), base0: { ...base }, mid0: mid, dist0: dist, last: null };
        }
        return;
      }
      if (n > 2 || panLatch.current) return;
      single.down(e);
    },
    onPointerMove: (e) => {
      const p = mapPtrs.current.get(e.pointerId); if (p) { p.x = e.clientX; p.y = e.clientY; }
      const g = mapGest.current;
      const pts = [...mapPtrs.current.values()];
      if (g && pts.length >= (mapPan ? 1 : 2)) {
        const a = pts[0], b = pts[1];
        const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: a.x, y: a.y };
        const dist = b ? (Math.hypot(a.x - b.x, a.y - b.y) || 1) : g.dist0; // 1 finger = translate only
        g.last = { tx: mid.x - g.mid0.x, ty: mid.y - g.mid0.y, scale: dist / g.dist0, ox: g.mid0.x - g.rect.left, oy: g.mid0.y - g.rect.top };
        setMapXform(g.last);
        return;
      }
      if (panLatch.current) return;
      single.move(e);
    },
    onPointerUp: (e) => {
      const g = mapGest.current;
      mapPtrs.current.delete(e.pointerId);
      if (g) {
        if (mapPtrs.current.size < 2) {
          mapGest.current = null; setMapXform(null);
          const L = g.last;
          if (L) {
            const { rect, base0 } = g, { tx, ty, scale, ox, oy } = L;
            // container centre after the live transform → the world point that
            // should sit at the centre now (inverse of T(v)=o+scale*(v-o)+t)
            const vx = ox + (rect.width / 2 - ox - tx) / scale, vy = oy + (rect.height / 2 - oy - ty) / scale;
            const [lat, lng] = pxToLl((vx / rect.width) * W, (vy / rect.height) * H, base0);
            const zoom = (scale > 1.02 || scale < 0.98) ? Math.min(ZMAX, Math.max(ZMIN, Math.round(base0.zoom + Math.log2(scale)))) : base0.zoom;
            setBase({ ...base, lat, lng, zoom });
          }
          panLatch.current = mapPtrs.current.size > 0;
        }
        if (mapPtrs.current.size === 0) panLatch.current = false;
        return;
      }
      if (panLatch.current) { if (mapPtrs.current.size === 0) panLatch.current = false; return; }
      single.up(e);
    },
  });
  const tracePtr = useRef(null);
  const sqDrag = useRef(null);                           // active square edit: {type,idx,...}
  const [traceMode, setTraceMode] = useState("points");  // "points" | "squares"
  const [selSq, setSelSq] = useState(null);              // selected shape index (square-edit)
  const [showDetails, setShowDetails] = useState(false);

  // fence estimator state
  const [fenceBase, setFenceBase] = useState(null); // {lat, lng, zoom, addr}
  const [fRuns, setFRuns] = useState([]);           // completed fence lines (lat/lng)
  const [fCur, setFCur] = useState([]);             // line being drawn
  const [fType, setFType] = useState("cedar");
  const [fLF, setFLF] = useState(String(FENCE_PRICES.cedar));
  // panel width in ft — 8 is the default, never a cage: editable in details
  // (ranch rail and chain link commonly run 10–12 ft between posts)
  const [fPanelW, setFPanelW] = useState("8");
  const [fWalkP, setFWalkP] = useState("250");
  const [fDblP, setFDblP] = useState("450");
  const [fMk, setFMk] = useState("0");
  const [fNoImg, setFNoImg] = useState(false);
  const [fImgN, setFImgN] = useState(0); // cache-buster for aerial retry
  // FENCE ACCURATE #4/#5 — selection model. The parcel is the STARTING
  // GEOMETRY, not the proposed fence: selection starts at ZERO feet. A route
  // is a span on the RAW ring: {a, b, dir} (vertex indexes, dir ±1) or
  // {full:true} for the whole perimeter. Two taps make a route (start → end,
  // shorter way first, "Usar el otro lado" flips), more taps add more tramos.
  const [fSel, setFSel] = useState([]);
  const [fStart, setFStart] = useState(null); // pending first tap (vertex idx)
  const [fFront, setFFront] = useState(false); // "Patio trasero": awaiting the STREET-side tap
  const [fMode, setFMode] = useState("sides"); // "sides" | "draw" | "gate" — one tap, one meaning
  // Map gates (#11): placed on a fence run. { runIdx, tFrac (0-1 along run),
  // kind, widthFt, price }. Replaces the gWalk/gDbl counters.
  const [fGates, setFGates] = useState([]);
  const [fGateEdit, setFGateEdit] = useState(null); // index being edited, or null
  const [fHist, setFHist] = useState([]); // unified undo history (snapshots)
  // Offset drag pointer: while dragging a point the CROSSHAIR floats above the
  // finger (finger would hide it) — {fx,fy finger, x,y placement, ft live}.
  const [fPtr, setFPtr] = useState(null);
  const [fLineSel, setFLineSel] = useState(null); // tapped free line → 🗑 chip
  // 🧭 Ajustar lote: when ON, one drag translates the parcel (raw + display)
  // AND every fence element together — for when the cadastral boundary sits
  // offset from the satellite photo. Auto-locks after the gesture.
  const [fAdjust, setFAdjust] = useState(false);
  // Property confirmation step (FENCE ACCURATE #3): the contractor confirms
  // the right lot BEFORE any measuring. { state, cands, sel, examples, addr, lat, lng }
  const [fConfirm, setFConfirm] = useState(null);

  // The contractor's saved fence price (Ajustes/wizard materials) beats the
  // built-in default for each fence type; custom stays the generic slot.
  const fencePriceOf = (k) => {
    const rx = { cedar: /cedro|cedar|madera|wood/i, vinyl: /vinil|vinyl/i, chain: /malla|chain|cicl/i, alum: /alumin/i, ranch: /rancho|ranch|tubo|riel|pipe/i }[k];
    const m = rx && myMaterials.find((mm) => rx.test(String(mm.n)));
    return m && m.p !== "" && m.p != null ? Number(m.p) : FENCE_PRICES[k];
  };
  // The catalog, materialized: the contractor's saved list, or the 5 defaults
  // (id doubles as the /fence/<id>.jpg photo key for the built-ins).
  const fenceProdList = () =>
    fenceProducts && fenceProducts.length
      ? fenceProducts
      : Object.keys(FENCE_PRICES).filter((k) => k !== "custom").map((k) => ({
          id: k, name: { cedar: t.cedar, vinyl: t.vinyl, chain: t.chain, alum: t.alum, ranch: t.ranch }[k],
          price: fencePriceOf(k), panelW: 8, on: true,
        }));
  const prodName = (id) => fenceProdList().find((p) => p.id === id)?.name || id;
  const saveFenceProducts = (next) => {
    setFenceProducts(next);
    saveProfile({ fenceProducts: next });
  };
  // Real Home Depot catalog shots for the picker (white-background product
  // photos) instead of the baked-in 3D renders. Fetched ONCE per product by
  // name (server caches the search 30 days), saved into the profile so it
  // never refetches; the renders stay as the fallback everywhere.
  const PROD_IMG_Q = {
    cedar: "6 ft cedar dog ear fence panel",
    vinyl: "6 ft white vinyl privacy fence panel",
    chain: "galvanized chain link fence fabric",
    alum: "black aluminum fence panel",
    ranch: "wood split rail fence",
  };
  const prodImgOf = (id) => fenceProdList().find((p) => p.id === id)?.img || `/fence/${id}.jpg`;
  const prodImgTried = useRef({}); // once per product per session — no retry loops
  const fetchProdImg = async (p2, i) => {
    const q = PROD_IMG_Q[p2.id] || `${String(p2.name || "").trim()} fence`;
    const r = await api("/api/fence/prodimg", { method: "POST", body: JSON.stringify({ q, i: i || 0, demo: DEMO_KEY }) });
    if (!r.ok) throw new Error("pimg_" + r.status);
    return r.json();
  };
  const loadProdImgs = async () => {
    const list = fenceProdList();
    const missing = list.filter((p2) => !p2.img && !prodImgTried.current[p2.id] && String(p2.name || "").trim().length >= 3);
    if (!missing.length) return;
    missing.forEach((p2) => { prodImgTried.current[p2.id] = 1; });
    let next = list, got = false;
    for (const p2 of missing) {
      try {
        const j = await fetchProdImg(p2, 0);
        if (j?.img) { next = next.map((q2) => (q2.id === p2.id ? { ...q2, img: j.img } : q2)); got = true; }
      } catch { return; } // no key / not entitled / offline → keep the renders, stay quiet
    }
    if (got) saveFenceProducts(next);
  };
  useEffect(() => {
    if (trade === "fence" && screen === "fenceDraw" && (session || DEMO_KEY)) loadProdImgs();
  }, [screen, trade]); // eslint-disable-line react-hooks/exhaustive-deps
  // Live Home Depot reference prices — a peek, never the quote engine
  const loadHdPrices = async () => {
    setFMat({ loading: true });
    try {
      const r = await api("/api/fence/materials", { method: "POST", body: JSON.stringify({ demo: DEMO_KEY }) });
      const j = await r.json();
      if (!r.ok || !j.items) throw new Error("mat");
      setFMat(j);
    } catch { setFMat(null); showToast("💲 " + t.matFail); }
  };
  // Per-quote takeoff: quantities from the SAME fenceQuote numbers on the
  // screen, prices from the live HD list. Recipe defaults are the industry
  // standard (2.2 pickets/ft, 3 rails/panel, 2 bags/post…) and EVERY line is
  // check/uncheckable and editable — a shopping reference, never the quote.
  const takeoffRows = (tk, items) => {
    const by = {};
    (items || []).forEach((it) => { if (it.k) by[it.k] = it; });
    const rows = [];
    const add = (k, qty, on = true) => { const it = by[k]; if (it && qty > 0) rows.push({ k, it, qty: Math.ceil(qty), on }); };
    const nm = (prodName(tk.prod) + " " + tk.prod).toLowerCase();
    if (/malla|chain|cicl/.test(nm)) {
      add("chainFabric", tk.netFt / 50);
      add("chainTerm", tk.postsTotal);
      add("chainTop", tk.netFt / 10.5);
      add("concrete", tk.postsTotal);
    } else if (/vinil|vinyl/.test(nm)) {
      add("vinylPanel", tk.panels);
      add("post44", tk.postsTotal);
      add("concrete", tk.postsTotal * 2);
    } else if (/alumin/.test(nm)) {
      add("post44", tk.postsTotal);
      add("concrete", tk.postsTotal * 2);
    } else {
      // wood privacy (cedro/pino/custom): 5.5-in pickets ≈ 2.2 per ft
      add(/pino|pine/.test(nm) ? "picketPine" : "picketCedar", tk.netFt * 2.2);
      add("post44", tk.postsTotal);
      add("postSteel", tk.postsTotal, false); // steel alternative — off by default
      add("rail24", tk.panels * 3);
      add("rot26", tk.panels);
      add("concrete", tk.postsTotal * 2);
    }
    if (tk.gates > 0) add("gateKit", tk.gates);
    return rows;
  };
  const HdPriceList = ({ takeoff }) => {
    const items = fMat?.items;
    const tkRows = takeoff && items ? takeoffRows(takeoff, items) : [];
    const ov = (k) => fTake[k] || {};
    const rowOn = (r) => (ov(r.k).on != null ? ov(r.k).on : r.on);
    const rowQty = (r) => (ov(r.k).qty != null ? ov(r.k).qty : r.qty);
    const rowPrice = (r) => (ov(r.k).price !== undefined ? ov(r.k).price : (r.it.price != null ? Number(r.it.price) : null));
    const setOv = (k, patch) => setFTake({ ...fTake, [k]: { ...fTake[k], ...patch } });
    const tkTotal = tkRows.reduce((s, r) => (rowOn(r) && rowPrice(r) != null ? s + rowQty(r) * rowPrice(r) : s), 0);
    const inp = { border: `1.5px solid ${C.line}`, borderRadius: 8, outline: "none", color: C.navy, fontWeight: 700, fontSize: 12, padding: "3px 4px", background: "#fff" };
    const fullList = items ? (
      <div>
        {items.map((m, i) => (
          <div key={i} className="flex items-center justify-between py-1" style={{ borderBottom: i < items.length - 1 ? `1px solid ${C.bg}` : "none" }}>
            {m.thumb ? <img src={m.thumb} alt="" draggable={false} className="rounded object-cover mr-2 flex-shrink-0 active:scale-95" style={{ width: 26, height: 26, cursor: "zoom-in" }}
              onClick={() => setFMatZoom(m)}
              onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
            <span className="text-xs font-semibold truncate mr-2 flex-1" style={{ color: C.navy }}>{lang === "es" ? m.es : m.en}</span>
            <span className="text-xs font-extrabold flex-shrink-0" style={{ color: m.price != null ? "#1E7B33" : C.slate }}>{m.price != null ? `$${Number(m.price).toFixed(2)}` : "—"}</span>
          </div>
        ))}
      </div>
    ) : null;
    return (
    <>
      {!fMat && (
        <button onClick={loadHdPrices} className="text-sm font-extrabold" style={{ background: "none", border: "none", color: "#1E7B33", padding: 0 }}>💲 {t.matBtn}</button>
      )}
      {fMat?.loading && <p className="text-xs font-semibold m-0" style={{ color: C.slate }}>💲 {t.matLoading}</p>}
      {items && (
        <div>
          {tkRows.length > 0 && (
            <div className="mb-2">
              <p className="text-sm font-extrabold m-0" style={{ color: C.navy }}>🛒 {t.matForQuote} <span style={{ color: C.slate, fontWeight: 700 }}>· {Number(takeoff.netFt).toLocaleString()} ft</span></p>
              <p className="text-[10.5px] font-semibold mt-0.5 mb-1.5" style={{ color: "#9AA3B2", lineHeight: 1.45 }}>{t.matForNote}</p>
              {tkRows.map((r) => (
                <div key={r.k} className="flex items-center gap-1.5 py-1.5" style={{ borderBottom: `1px solid ${C.bg}`, opacity: rowOn(r) ? 1 : 0.45 }}>
                  <input type="checkbox" checked={rowOn(r)} onChange={(e) => setOv(r.k, { on: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: "#1E7B33", flexShrink: 0 }} />
                  {r.it.thumb ? <img src={r.it.thumb} alt="" draggable={false} className="rounded object-cover flex-shrink-0" style={{ width: 22, height: 22, cursor: "zoom-in" }}
                    onClick={() => setFMatZoom(r.it)} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}
                  <span className="text-xs font-semibold truncate flex-1 min-w-0" style={{ color: C.navy }}>{lang === "es" ? r.it.es : r.it.en}</span>
                  <input type="number" inputMode="numeric" value={rowQty(r)} onChange={(e) => setOv(r.k, { qty: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className="text-right flex-shrink-0" style={{ ...inp, width: 44 }} />
                  <span className="text-[10px] font-bold flex-shrink-0" style={{ color: C.slate }}>×</span>
                  <input type="number" inputMode="decimal" step="0.01" value={rowPrice(r) ?? ""} placeholder="—"
                    onChange={(e) => setOv(r.k, { price: e.target.value === "" ? null : Math.max(0, parseFloat(e.target.value) || 0) })}
                    className="text-right flex-shrink-0" style={{ ...inp, width: 56 }} />
                  <span className="text-xs font-extrabold text-right flex-shrink-0" style={{ color: rowOn(r) && rowPrice(r) != null ? "#1E7B33" : C.slate, width: 52 }}>
                    {rowOn(r) && rowPrice(r) != null ? `$${Math.round(rowQty(r) * rowPrice(r)).toLocaleString()}` : "—"}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-0.5" style={{ borderTop: `2px solid ${C.navy}` }}>
                <span className="text-xs font-extrabold tracking-wide" style={{ color: C.navy }}>{t.matTotal}</span>
                <span className="font-extrabold" style={{ color: "#1E7B33", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24 }}>${Math.round(tkTotal).toLocaleString()}</span>
              </div>
              {/* the printable shopping sheet — the CONTRACTOR's document
                  (marked USO INTERNO), never something the homeowner sees */}
              <button onClick={async () => {
                const rows = tkRows.filter((r) => rowOn(r)).map((r) => [lang === "es" ? r.it.es : r.it.en, rowQty(r), rowPrice(r)]);
                const cust = customers.find((c2) => c2.id === leadCustRef.current);
                const payload = {
                  lg: (await ensureLogoId()) || undefined,
                  biz: bizName || "ALTO Pro", ph: userPhone, lang,
                  cn: cust?.name || "", ca: takeoff.addr || "",
                  dt: new Date().toLocaleDateString(lang === "es" ? "es-MX" : "en-US"),
                  m: { net: takeoff.netFt, gross: takeoff.grossFt, gate: takeoff.gateFt, panels: takeoff.panels,
                    postsTotal: takeoff.postsTotal, posts: takeoff.postsB, corners: takeoff.corners,
                    gates: takeoff.gates, pw: takeoff.panelW, prod: prodName(takeoff.prod),
                    la: takeoff.lat, ln: takeoff.lng, zm: takeoff.zoom, li: takeoff.lines },
                  rows, zip: fMat.zip, upd: new Date(fMat.updatedAt).toLocaleDateString(),
                };
                const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
                window.location.href = "/m?d=" + b64 + "&app=1";
              }} className="w-full rounded-xl py-2.5 mt-2 text-sm font-bold active:scale-95"
                style={{ background: "#fff", border: "1.5px solid #1E7B33", color: "#1E7B33", cursor: "pointer" }}>📄 {t.matSheet}</button>
            </div>
          )}
          {tkRows.length > 0 ? (
            <>
              <button onClick={() => setFMatAll(!fMatAll)} className="text-xs font-bold mb-1" style={{ background: "none", border: "none", color: C.slate, padding: 0 }}>
                {fMatAll ? "▴ " : "▾ "}{t.matFullList}
              </button>
              {fMatAll && fullList}
            </>
          ) : fullList}
          <p className="text-[10px] font-semibold mt-1 mb-0" style={{ color: "#9AA3B2" }}>Home Depot {fMat.zip} · {t.matUpdated} {new Date(fMat.updatedAt).toLocaleDateString()}</p>
        </div>
      )}
      {/* Tap a thumbnail -> the product big. HD's CDN encodes size in the
          filename, so ask for the 600px version; fall back to the thumb. */}
      {fMatZoom && (
        <div onClick={() => setFMatZoom(null)}
          className="fixed inset-0 flex items-center justify-center p-6"
          style={{ background: "rgba(16,27,48,.85)", zIndex: 60, cursor: "zoom-out" }}>
          <div className="rounded-2xl overflow-hidden text-center" style={{ background: "#fff", maxWidth: 340, width: "100%" }}>
            <img src={String(fMatZoom.thumb || "").replace(/_(\d{2,3})(\.\w+)$/, "_600$2")} alt=""
              draggable={false} className="w-full object-contain" style={{ maxHeight: "50vh", background: "#fff" }}
              onError={(e) => { if (e.currentTarget.src !== fMatZoom.thumb) e.currentTarget.src = fMatZoom.thumb; }} />
            <div className="px-4 py-3">
              <p className="text-sm font-extrabold m-0" style={{ color: C.navy }}>{lang === "es" ? fMatZoom.es : fMatZoom.en}</p>
              {fMatZoom.title && <p className="text-[11px] font-semibold mt-0.5 mb-1" style={{ color: C.slate }}>{fMatZoom.title}</p>}
              <p className="font-extrabold m-0" style={{ color: "#1E7B33", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 30 }}>
                {fMatZoom.price != null ? `$${Number(fMatZoom.price).toFixed(2)}` : "—"}</p>
            </div>
          </div>
        </div>
      )}
    </>
    );
  };
  // Shared products editor: lives in Ajustes and behind the ⚙️ tile on the
  // fence screen (closable there). Check = shown in the app; add = custom.
  const FenceProductsCard = ({ closable }) => (
    <div className="rounded-2xl p-3 mb-3" style={{ background: "#fff", border: `1.5px solid ${closable ? C.orange : C.line}` }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-extrabold" style={{ color: C.navy }}>🪵 {t.prodTitle}</span>
        {closable && <button onClick={() => setFProdEdit(false)} className="text-xs font-bold px-3 py-1 rounded-lg" style={{ background: C.navy, color: "#fff", border: "none" }}>{t.done}</button>}
      </div>
      <p className="text-[11px] font-semibold mb-2" style={{ color: C.slate }}>{t.prodHint}</p>
      {fenceProdList().map((p2, i) => (
        <div key={p2.id} className="flex items-center gap-1.5 mb-1.5">
          <input type="checkbox" checked={p2.on !== false}
            onChange={(e) => saveFenceProducts(fenceProdList().map((q2, j) => (j === i ? { ...q2, on: e.target.checked } : q2)))}
            style={{ width: 18, height: 18, accentColor: C.orange, flexShrink: 0 }} />
          {/* the product's photo + 🔄 = search the next Home Depot match
              (for when the first result grabbed the wrong item) */}
          <img src={p2.img || `/fence/${p2.id}.jpg`} alt="" draggable={false}
            className="rounded object-cover flex-shrink-0" style={{ width: 24, height: 24, background: "#fff", border: `1px solid ${C.line}` }}
            onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          <button title={t.prodImgSwap} aria-label={t.prodImgSwap} onClick={async () => {
            const n = (Number(p2.imgN) || 0) + 1;
            try {
              const j = await fetchProdImg(p2, n);
              if (j?.img) saveFenceProducts(fenceProdList().map((q2, j2) => (j2 === i ? { ...q2, img: j.img, imgN: n } : q2)));
              else throw new Error("no_img");
            } catch { showToast("📷 " + t.prodImgFail); }
          }} className="flex-shrink-0 px-0.5" style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer" }}>🔄</button>
          <input value={p2.name} placeholder={t.matNameLbl}
            onChange={(e) => saveFenceProducts(fenceProdList().map((q2, j) => (j === i ? { ...q2, name: e.target.value } : q2)))}
            className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-xs font-semibold" style={{ border: `1.5px solid ${C.line}`, outline: "none", color: C.navy }} />
          <div className="flex items-center rounded-lg px-1.5" style={{ border: `1.5px solid ${C.line}` }}>
            <span className="text-[10px] font-bold" style={{ color: C.slate }}>$</span>
            <input type="number" inputMode="decimal" value={p2.price}
              onChange={(e) => saveFenceProducts(fenceProdList().map((q2, j) => (j === i ? { ...q2, price: e.target.value } : q2)))}
              className="w-10 py-1.5 text-right text-xs font-bold outline-none bg-transparent" style={{ color: C.navy }} />
          </div>
          <div className="flex items-center rounded-lg px-1.5" style={{ border: `1.5px solid ${C.line}` }}>
            <input type="number" inputMode="decimal" value={p2.panelW}
              onChange={(e) => saveFenceProducts(fenceProdList().map((q2, j) => (j === i ? { ...q2, panelW: e.target.value } : q2)))}
              className="w-8 py-1.5 text-right text-xs font-bold outline-none bg-transparent" style={{ color: C.navy }} />
            <span className="text-[10px] font-bold" style={{ color: C.slate }}>ft</span>
          </div>
          {!FENCE_PRICES[p2.id] ? (
            <button onClick={() => saveFenceProducts(fenceProdList().filter((_, j) => j !== i))}
              className="text-sm font-bold px-0.5" style={{ background: "none", border: "none", color: C.red }}>✕</button>
          ) : <span style={{ width: 12 }} />}
        </div>
      ))}
      <button onClick={() => saveFenceProducts([...fenceProdList(), { id: "p" + Date.now(), name: "", price: "", panelW: 8, on: true }])}
        className="text-sm font-extrabold" style={{ background: "none", border: "none", color: C.orange, padding: 0 }}>+ {t.prodAdd}</button>
      <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
        <HdPriceList />
      </div>
    </div>
  );
  // A fence "base" identifies one property visit: parcelId when we have a
  // confirmed parcel, else the coordinates. Re-opening the SAME property (e.g.
  // Back from the map to the confirm screen and forward again) keeps every
  // selection, run and gate — nothing is lost to navigation.
  const fenceKey = (b) => (b ? b.parcelId || `${b.lat},${b.lng}` : null);
  const openFence = (base) => {
    // frame the whole property when a parcel ring is present. H:1280 = the
    // fence map is a SQUARE 1280×1280 view (roofimg &sq=1) — much bigger on a
    // phone than the 16:10 roofing trace, where finger precision matters less.
    let framed = { zoom: 19, ...base, H: 1280 };
    if (base.parcel && base.parcel.length >= 3) {
      let s = 90, w = 180, nn = -90, e = -180;
      base.parcel.forEach(([la, ln]) => { s = Math.min(s, la); nn = Math.max(nn, la); w = Math.min(w, ln); e = Math.max(e, ln); });
      const ctrLat = (s + nn) / 2, ctrLng = (w + e) / 2;
      const span = Math.max(nn - s, (e - w) * Math.cos(ctrLat * Math.PI / 180), 0.0001) * 1.6;
      const z = Math.min(Math.max(Math.floor(Math.log2((360 * (640 / 256)) / span)), 15), 20);
      framed = { ...base, lat: ctrLat, lng: ctrLng, zoom: z, H: 1280 };
    }
    const same = fenceKey(framed) === fenceKey(fenceBase);
    // Same parcel re-opened: keep an 🧭-adjusted boundary (the owner aligned
    // it with the photo once — don't snap it back to the raw cadastral spot).
    setFenceBase(same && fenceBase ? { ...framed, parcel: fenceBase.parcel || framed.parcel, raw: fenceBase.raw || framed.raw } : framed);
    setFAdjust(false);
    setFNoImg(false);
    if (!same) {
      setFCur([]);
      // A real parcel opens with the fence ALREADY there: a straight orange
      // polygon whose vertices are the lot's logical corners — every corner a
      // visible grab-dot from second one. The red line stays the exact county
      // truth; fences are built straight post-to-post (owner-blessed).
      const ring0 = base.raw || base.parcel;
      let initRuns = [];
      if (ring0 && ring0.length >= 3) {
        // keep every REAL bend (≥5°) so the fence HUGS the boundary — only
        // survey noise is dropped; a chamfered corner is never cut across
        const n0 = ring0.length, k0 = Math.PI / 180;
        const turn0 = (i) => {
          const a = ring0[(i - 1 + n0) % n0], b = ring0[i], c = ring0[(i + 1) % n0];
          const cz = Math.cos(b[0] * k0);
          const v1 = [(b[1] - a[1]) * cz, b[0] - a[0]], v2 = [(c[1] - b[1]) * cz, c[0] - b[0]];
          const m1 = Math.hypot(...v1), m2 = Math.hypot(...v2);
          if (!m1 || !m2) return 0;
          return (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)))) * 180) / Math.PI;
        };
        let keep0 = [...Array(n0).keys()].filter((i) => turn0(i) >= 5);
        if (keep0.length < 3) keep0 = [...Array(n0).keys()];
        const cp0 = keep0.map((i) => ring0[i]);
        initRuns = [[...cp0, cp0[0]]]; // duplicate end = closed loop
      }
      setFRuns(initRuns);
      setFSel([]);
      setFStart(null); setFFront(false); setFHist([]);
      setFGates([]); setFGateEdit(null);
      setFMode(base.parcel && base.parcel.length >= 3 ? "sides" : "draw");
      setFLF(String(fencePriceOf(fType)));
      if (myPrices.walkGate != null && myPrices.walkGate !== "") setFWalkP(String(myPrices.walkGate));
      if (myPrices.dblGate != null && myPrices.dblGate !== "") setFDblP(String(myPrices.dblGate));
      setShowDetails(false);
    }
    setScreen("fenceDraw");
  };

  /* ── Importar levantamiento (survey → exact lot) ──
   * The homeowner's plat is the ground truth. The server reads the boundary
   * calls off the photo/PDF; surveyTraverse turns them into the exact lot
   * polygon; we feed it into openFence AS A PARCEL so the contractor lands in
   * the normal tap-the-sides flow on an exact lot — then edits/aligns with 🧭.
   * A misread never corrupts silently: the numbers are visible and editable. */
  const surveyInputRef = useRef(null);
  const surveyAnchor = useRef(null);
  const [surveyBusy, setSurveyBusy] = useState(false);
  const pickSurvey = (anchor) => { surveyAnchor.current = anchor || null; try { surveyInputRef.current?.click(); } catch { /* no picker */ } };
  const onSurveyPicked = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // let the same file be re-picked after an edit
    if (!file || surveyBusy) return;
    if (file.size > 12 * 1024 * 1024) { showToast(t.surveyTooBig); return; }
    setSurveyBusy(true);
    showToast(t.surveyReading);
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = () => res(String(rd.result).split(",")[1] || "");
        rd.onerror = () => rej(new Error("read"));
        rd.readAsDataURL(file);
      });
      const resp = await api("/api/survey-extract", {
        method: "POST",
        body: JSON.stringify({ file: b64, mime: file.type || "image/jpeg", demo: demoPass || DEMO_KEY || undefined }),
      });
      if (!resp.ok) { showToast(resp.status === 403 ? t.surveyLogin : t.surveyErr); setSurveyBusy(false); return; }
      const data = await resp.json().catch(() => ({}));
      const calls = surveyNormalize(data.calls || []);
      if (calls.length < 3) { showToast(t.surveyNone); setSurveyBusy(false); return; }
      const tv = surveyTraverse(calls);
      // feet → lat/lng. Bearings are true-north referenced and the aerial is
      // north-up, so the shape needs no rotation — only an anchor point. Center
      // the lot on the current map center (or the picked address) so the
      // satellite underneath shows the real property; 🧭 nudges any offset.
      const FT_PER_DEG = (Math.PI / 180) * 6378137 * 3.28084;
      const anchor = surveyAnchor.current || (fenceBase ? { lat: fenceBase.lat, lng: fenceBase.lng, addr: fenceBase.addr } : null);
      const lat0 = anchor && Number.isFinite(anchor.lat) ? anchor.lat : 30.2672;
      const lng0 = anchor && Number.isFinite(anchor.lng) ? anchor.lng : -97.7431;
      const cx = tv.ring.reduce((s, p) => s + p.x, 0) / tv.ring.length;
      const cy = tv.ring.reduce((s, p) => s + p.y, 0) / tv.ring.length;
      const ring = tv.ring.map((p) => [
        lat0 + (p.y - cy) / FT_PER_DEG,
        lng0 + (p.x - cx) / (FT_PER_DEG * Math.cos((lat0 * Math.PI) / 180)),
      ]);
      setFConfirm(null);
      openFence({ lat: lat0, lng: lng0, addr: (anchor && anchor.addr) || "", parcel: ring, raw: ring, parcelId: `survey-${Date.now()}`, fromSurvey: true });
      showToast(tv.closurePct > 0.03 ? t.surveyRough : `${t.surveyDone} · ${Math.round(tv.perimFt).toLocaleString()} ft`);
    } catch (err) {
      showToast(t.surveyErr);
    }
    setSurveyBusy(false);
  };
  const surveyInput = (
    <input ref={surveyInputRef} type="file" accept="image/*,application/pdf" onChange={onSurveyPicked}
      style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} tabIndex={-1} />
  );

  // voice invoice draft
  const [viHeard, setViHeard] = useState("");
  const [viName, setViName] = useState("");
  const [viConcept, setViConcept] = useState("");
  const [viAmount, setViAmount] = useState("");
  const [viBusy, setViBusy] = useState(false);
  const [viLines, setViLines] = useState([]); // accumulated invoice lines
  const [viAddr, setViAddr] = useState("");   // optional: the house, for photos on the document
  const [viLoc, setViLoc] = useState(null);   // {lat,lng,formatted} once found
  const [viGeoBusy, setViGeoBusy] = useState(false);
  const [viImgAer, setViImgAer] = useState(true);  // include aerial view
  const [viImgStr, setViImgStr] = useState(true);  // include street photo
  const viFindHouse = async () => {
    if (!viAddr.trim() || viGeoBusy) return;
    setViGeoBusy(true);
    try {
      const r = await api("/api/geocode", { method: "POST", body: JSON.stringify({ address: viAddr, demo: DEMO_KEY }) });
      const j = r.ok ? await r.json() : null;
      if (j && j.lat != null) { setViLoc(j); setViImgAer(true); setViImgStr(true); }
      else showToast("⚠️ " + t.viNotFound);
    } catch { showToast("⚠️ " + t.viNotFound); }
    setViGeoBusy(false);
  };

  const viParse = async (text) => {
    setViHeard(text);
    setViBusy(true);
    let p = null;
    try {
      const r = await api("/api/parse", {
        method: "POST",
        body: JSON.stringify({ text, lang }),
      });
      if (r.ok) p = await r.json();
    } catch { /* backend unreachable */ }
    if (!p) {
      // offline fallback: biggest number = amount, "para X" = name
      const nums = [...text.matchAll(/\$?\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map(m => parseFloat(m[1].replace(/,/g, "")));
      const nm = text.match(/(?:para|for)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]*(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ'-]*){0,2})/i);
      p = { name: nm ? nm[1].trim() : "", concept: text.trim(), amount: nums.length ? Math.max(...nums) : null };
    }
    if (Array.isArray(p.lines) && p.lines.length) {
      // one spoken sentence → the whole invoice: every item becomes a line
      const clean = p.lines
        .map((l) => [String(l.c || l.concept || "").trim(), Math.round(Number(l.a ?? l.amount) || 0)])
        .filter(([c2, a2]) => c2 && a2 > 0);
      if (clean.length) {
        setViLines((v) => [...v, ...clean]);
        if (p.name) setViName((n) => n || p.name);
        setViConcept("");
        setViAmount("");
        setViBusy(false);
        return;
      }
    }
    setViName((n) => n || p.name || "");
    setViConcept(p.concept || text);
    setViAmount(p.amount != null ? String(p.amount) : "");
    setViBusy(false);
  };

  // Exceptional ears: record real audio and transcribe with Whisper on the
  // server (far better Spanish than the browser engine). Tap to talk, tap to
  // finish. Falls back to the browser's speech recognition if the mic API or
  // the server transcriber is unavailable.
  const recRef = useRef(null);
  const [recState, setRecState] = useState("idle"); // idle | rec | busy
  const recToggle = async (onText = viParse) => {
    if (recState === "rec") { try { recRef.current?.stop(); } catch { /* already stopped */ } return; }
    if (recState === "busy") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
        : (window.MediaRecorder && MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecState("busy");
        try {
          const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
          const b64 = await new Promise((rs, rj) => {
            const fr = new FileReader();
            fr.onload = () => rs(String(fr.result).split(",")[1] || "");
            fr.onerror = rj;
            fr.readAsDataURL(blob);
          });
          const r = await api("/api/transcribe", { method: "POST", body: JSON.stringify({ audio: b64, mime: blob.type.split(";")[0], lang, demo: DEMO_KEY }) });
          const j = r.ok ? await r.json() : null;
          if (j && j.text) { await onText(j.text); }
          else if (hasVoice) startVoice(onText); // server can't transcribe → browser engine
          else showToast("⚠️ " + t.sttErr);
        } catch { showToast("⚠️ " + t.sttErr); }
        setRecState("idle");
      };
      mr.start();
      recRef.current = mr;
      setRecState("rec");
      setTimeout(() => { if (recRef.current === mr && mr.state === "recording") { try { mr.stop(); } catch { /* raced */ } } }, 30000);
      return;
    } catch { /* mic blocked or unsupported */ }
    if (hasVoice) startVoice(onText);
    else showToast("⚠️ " + t.sttErr);
  };

  // Add the line being typed to the list (a real invoice has several simple
  // lines: "Subida de teja $360", "Instalacion de tejado $1,200"...)
  const viAddLine = () => {
    const amount = Math.round(parseFloat(viAmount) || 0);
    if (!amount || !viConcept.trim()) return;
    setViLines([...viLines, [viConcept.trim(), amount]]);
    setViConcept("");
    setViAmount("");
  };
  const viCreate = (kind = "inv") => {
    const cur = Math.round(parseFloat(viAmount) || 0) > 0 && viConcept.trim()
      ? [[viConcept.trim(), Math.round(parseFloat(viAmount))]]
      : [];
    const lines = [...viLines, ...cur];
    if (!lines.length) return;
    const total = lines.reduce((s, [, v]) => s + v, 0);
    let cust = customers.find(c => c.name.toLowerCase() === viName.trim().toLowerCase());
    if (!cust) {
      cust = { id: Date.now() + 1, name: viName.trim() || "—", phone: "", addr: "" };
      setCustomers([...customers, cust]);
    }
    const id = Date.now();
    const title = lines[0][0] + (lines.length > 1 ? ` +${lines.length - 1}` : "");
    const job = {
      id, date: id, inv: nextInv(), custId: cust.id, title: { es: title, en: title },
      amount: total, paidAmt: 0, status: kind === "est" ? "estimate" : "done", days: 0, photos: 0, lines,
      // Optional house photos: lat/lng only (no measurement) — the document
      // shows the street + aerial shots the contractor left checked.
      addr: viLoc?.formatted || "",
      meas: viLoc ? { lat: viLoc.lat, lng: viLoc.lng, ...(viImgStr ? {} : { noStreet: 1 }), ...(viImgAer ? {} : { noAerial: 1 }) } : null,
    };
    setJobs([job, ...jobs]);
    setActiveJobId(id);
    setViLines([]); setViConcept(""); setViAmount(""); setViAddr(""); setViLoc(null);
    setScreen(kind === "est" ? "send" : "invoice");
    showToast(t.estCreated + " ✓");
  };

  // voice input for the address (works on phones that support speech recognition)
  const [listening, setListening] = useState(false);
  const hasVoice = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const startVoice = (onResult) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.lang = lang === "es" ? "es-US" : "en-US";
    r.onresult = (e) => { setListening(false); onResult(e.results[0][0].transcript); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  };

  /* ── Sharing: everything travels inside the link, no server storage ── */
  // Fence estimates get their own document (/f): satellite diagram with the
  // red lot line + orange fence + green gates, per-side table, construction
  // breakdown and itemized price. The server recomputes the quote with the
  // same fenceMath engine, so the document always matches the app.
  const buildFenceEstUrl = (job, lgId) => {
    const c = custOf(job);
    const m = job.meas;
    const payload = {
      lg: lgId || undefined,
      inv: job.inv, biz: bizName || "ALTO Pro", ph: userPhone,
      cn: c.name, ca: job.addr || c.addr || "", lang,
      em: bizEmail || undefined, lic: license || undefined, zelle: zelleNum || "",
      wr: warrantyOn && String(warrantyText || "").trim() ? String(warrantyText).trim().slice(0, 200) : undefined,
      pc: m.parcel && m.parcel.length >= 3 ? m.parcel : undefined,
      l: m.lines,
      g: (m.gates || []).map((g) => [g.a[0], g.a[1], g.b[0], g.b[1], g.price ?? 0]),
      pr: { n: m.prod, lf: m.lfPrice, pw: m.panelW }, mk: m.markupPct || 0,
      dt: new Date().toLocaleDateString(lang === "es" ? "es-MX" : "en-US"),
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${window.location.origin}/f?d=${b64}`;
  };
  const buildShareUrl = (job, kind, lgId) => {
    // measured fence estimate → the fence document (invoices/receipts stay /i)
    if (kind === "est" && job.meas && job.meas.prod && job.meas.netFt != null) return buildFenceEstUrl(job, lgId);
    const c = custOf(job);
    const labelOf = (k) => (k === "labor" ? t.labor : t[k] || k);
    const payload = {
      lg: lgId || undefined,
      k: kind, inv: job.inv, biz: bizName || "South Texas Roofing", ph: userPhone,
      cn: c.name, ca: job.addr || c.addr || "", ti: job.title[lang],
      li: job.lines.map(([k, v]) => [labelOf(k), v]),
      tot: job.amount, dep: job.paidAmt, paid: job.status === "paid",
      lang, zelle: zelleNum || "", lic: license || undefined, em: bizEmail || undefined,
      // The "what's included" scope is the ROOF-REPLACEMENT checklist — it only
      // belongs on measured roof quotes. A simple invoice ("subida de teja
      // $360") must claim only the lines the contractor actually put on it.
      sc: job.meas?.roofArea ? String(scope || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 12) : undefined,
      wr: warrantyOn && String(warrantyText || "").trim() ? String(warrantyText).trim().slice(0, 200) : undefined,
      m: job.meas ? { la: job.meas.lat, ln: job.meas.lng, bb: job.meas.bbox, o: job.meas.outline, l: job.meas.lines, sd: job.meas.streetDate || undefined, ...(job.meas.noStreet ? { sv: 0 } : {}), ...(job.meas.noAerial ? { av: 0 } : {}) } : null,
      ms: job.meas && job.meas.roofArea ? { ra: job.meas.roofArea, pi: job.meas.pitch, sq: job.meas.squares, id: job.meas.imageryDate } : null,
      dt: new Date().toLocaleDateString(lang === "es" ? "es-MX" : "en-US"),
      ...(kind === "rec" && job.lastPay ? { pay: { a: job.lastPay.a, m: job.lastPay.m } } : {}),
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${window.location.origin}/i?d=${b64}`;
  };

  // Open the measurement report (/r) for a saved job's measurement.
  const openMeasReport = async (m, addr) => {
    const sq = m.squares || Math.ceil((m.roofArea || 0) / 100);
    const w = m.waste != null ? m.waste : 10;
    const d = {
      biz: bizName || "", ph: userPhone || "", em: bizEmail || undefined, lic: license || undefined,
      lg: (await ensureLogoId()) || undefined,
      addr, la: m.lat, ln: m.lng, bb: m.bbox || undefined,
      o: m.outline ? m.outline.slice(0, 60) : undefined,
      ra: Math.round(m.roofArea || 0), pi: m.pitch, sq, w, msq: Math.ceil(sq * (1 + w / 100)),
      seg: m.segments || 1, id: m.imageryDate || undefined, sd: m.streetDate || undefined,
      src: "live", lang, dt: new Date().toLocaleDateString(lang === "es" ? "es-MX" : "en-US"),
    };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    window.location.href = "/r?d=" + b64 + "&app=1";
  };

  // One tap → turn-by-turn to the house from wherever the contractor IS right
  // now. The maps app owns location, traffic and routing — free, no location
  // permission in our app, no API bill. Address preferred (reads nicely in
  // Maps); the measured lat/lng backs it up when there's no address text.
  // CRITICAL for the installed app: on phones we use the platform's custom
  // URL scheme (maps:// / geo:), which app-switches to the native Maps app
  // WITHOUT unloading ours — the PWA stays exactly where it was and the
  // status-bar "◀ back" chip returns to it. Navigating the window to a
  // https maps URL would replace the app with no back button (standalone
  // mode has no browser chrome) — that's being kicked out, never do it.
  const driveTo = (addr, lat, lng) => {
    // In-app overlay — the installed PWA must never lose its page. External
    // Google Maps (turn-by-turn) lives behind the explicit button inside.
    const a = String(addr || "").trim();
    if (!a && (lat == null || lng == null)) return;
    setDriveDest({ addr: a, lat: lat != null ? lat : null, lng: lng != null ? lng : null });
  };

  // Digits-only US phone (drops a leading country 1) for tel:/sms: links.
  const telDigits = (p) => String(p || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const callCust = (c) => { const n = telDigits(c.phone); if (n) window.location.href = `tel:+1${n}`; else showToast("⚠️ " + t.noPhone); };
  const textCust = (c, body) => {
    const n = telDigits(c.phone);
    if (!n) { showToast("⚠️ " + t.noPhone); return; }
    window.location.href = `sms:+1${n}` + (body ? `?&body=${encodeURIComponent(body)}` : "");
  };

  const shareDoc = async (job, kind) => {
    const c = custOf(job);
    const url = buildShareUrl(job, kind, await ensureLogoId());
    const msg = `${kind === "inv" ? t.invMsg : kind === "rec" ? t.recMsg : t.estMsg} #${job.inv} ${t.fromMsg} ${bizName || "ALTO Pro"}: ${url}`;
    if (navigator.share) {
      try { await navigator.share({ text: msg }); showToast(`${t.sentTo} ${c.name} 📱`); } catch { /* user closed the share sheet */ }
      return;
    }
    try { await navigator.clipboard.writeText(msg); showToast("🔗 " + t.linkCopied); } catch { /* ignore */ }
    const num = (c.phone || "").replace(/[^\d+]/g, "");
    window.location.href = `sms:${num}?&body=${encodeURIComponent(msg)}`;
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { showToast("⚠️ " + t.locErr); return; }
    showToast("📍 " + t.locating);
    navigator.geolocation.getCurrentPosition(
      (pos) => startLookup(t.myLocation, null, { lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => showToast("⚠️ " + t.locErr),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const openTrace = (base) => {
    setTraceBase(base);
    setTraceSecs([]);
    setTraceCur([]);
    setTraceNoImg(false);
    setGmapOff(false); setGmapErr(""); // give the real Google map a fresh try each time
    setScreen("trace");
  };

  const applyTrace = (secsOverride) => {
    const secs = Array.isArray(secsOverride) ? secsOverride : (traceCur.length >= 3 ? [...traceSecs, traceCur] : traceSecs);
    const fp = Math.round(secs.reduce((s, p) => s + traceAreaSqft(p), 0));
    if (!fp) return;
    const factor = PITCH_FACTORS[pitch] || 1.118;
    const area = Math.round(fp * factor);
    setLookup(prev => ({
      ...(prev || {}),
      addr: traceBase.addr || prev?.addr || "",
      lat: traceBase.lat, lng: traceBase.lng,
      roofArea: area, pitch,
      stories: prev?.stories || parseInt(stories) || 1,
      sqft: prev?.sqft || 0, beds: prev?.beds, baths: prev?.baths, year: prev?.year,
      segments: secs.length, segs: [], bbox: null,
      source: "trace", imageryDate: prev?.imageryDate,
    }));
    setMSq(String(Math.ceil(area / 100)));
    setFp(String(fp));
    setScreen("calc");
    showToast("✏️ " + t.roofMeasured + " ✓");
  };

  const onAddrInput = (v) => {
    setAddrQ(v);
    const q = v.trim();
    placesSeq.current += 1;
    const seq = placesSeq.current;
    if (!q) { setPlaceSugs(null); return; }
    fetch(`/api/places?q=${encodeURIComponent(q)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (seq === placesSeq.current && j && Array.isArray(j.suggestions)) setPlaceSugs(j.suggestions);
      })
      .catch(() => {}); // backend not running — keep the built-in list
  };

  const roofCalc = useMemo(() => {
    const f = parseFloat(fp) || 0;
    const factor = PITCH_FACTORS[pitch] || 1.118;
    const area = lookup ? lookup.roofArea : f * factor;
    const squares = lookup ? Math.max(0, Math.ceil(parseFloat(mSq) || 0)) : Math.ceil(area / 100);
    const matSquares = Math.ceil(squares * (1 + (roofWaste || 10) / 100));
    const matCost = matSquares * (parseFloat(matSq) || 0);
    const acc = Math.round(matSquares * 30);
    const storyMult = 1 + (Math.max(1, parseInt(stories) || 1) - 1) * 0.1;
    const labCost = Math.round(squares * (parseFloat(labSq) || 0) * storyMult);
    const tearCost = tearOff ? Math.round(squares * (parseFloat(tearSq) || 0) * Math.max(1, parseInt(layers) || 1)) : 0;
    return { factor, area, squares, matSquares, matCost, acc, labCost, tearCost, total: matCost + acc + labCost + tearCost };
  }, [fp, pitch, stories, roofMat, tearOff, layers, matSq, labSq, tearSq, lookup, mSq, roofWaste]);

  const [aiMsgs, setAiMsgs] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2400); };

  const calc = useMemo(() => {
    const l = parseFloat(L) || 0, w = parseFloat(W) || 0, th = parseFloat(TH) || 0, ws = parseFloat(waste) || 0;
    const yards = (l * w * (th / 12)) / 27;
    const withWaste = yards * (1 + ws / 100);
    const orderY = Math.ceil(withWaste * 2) / 2;
    const trucks = Math.max(1, Math.ceil(orderY / 10));
    const mat = orderY * (parseFloat(ppy) || 0);
    const lab = l * w * (parseFloat(laborRate) || 0);
    return { yards, withWaste, orderY, trucks, mat, lab, total: mat + lab, sqft: l * w };
  }, [L, W, TH, waste, ppy, laborRate]);

  // Live age of a job's balance — the stored j.days was frozen at creation,
  // so real jobs always showed "0d" and the overdue flag never fired.
  const daysOld = (j) => (j.date ? Math.max(0, Math.floor((Date.now() - j.date) / 864e5)) : (j.days || 0));
  // Unique, always-increasing invoice # — jobs.length collided after a delete.
  const nextInv = () => jobs.reduce((m, j) => Math.max(m, j.inv || 0), 1043) + 1;
  const owed = jobs.filter(j => j.status !== "paid" && j.status !== "estimate").reduce((s, j) => s + (j.amount - j.paidAmt), 0);
  const activeJob = jobs.find(j => j.id === activeJobId);
  const custOf = (j) => customers.find(c => c.id === j.custId) || {};

  const createEstimate = (custId, estOverride) => {
    const p = estOverride || pendingEstimate || {
      title: lang === "es" ? `Losa ${L}×${W}, ${TH}″` : `Slab ${L}×${W}, ${TH}″`,
      lines: [["lineSlab", Math.round(calc.mat)], ["labor", Math.round(calc.lab)]],
      total: Math.round(calc.total),
    };
    const id = Date.now();
    const job = {
      id, date: id, inv: nextInv(), custId, title: { es: p.title, en: p.title },
      amount: p.total, paidAmt: 0, status: "estimate", days: 0, photos: 0, lines: p.lines,
      addr: p.addr || "", meas: p.meas || null,
    };
    setJobs([job, ...jobs]);
    setActiveJobId(id);
    setPendingEstimate(null);
    setScreen("send");
    showToast(t.estCreated + " ✓");
  };

  // keepAddr: re-measuring at a hand-picked spot ("wrong house" fix) keeps the
  // address the contractor typed instead of the reverse-geocoded neighbor's.
  const startLookup = async (addr, placeId = null, gps = null, keepAddr = false) => {
    // Demo mode gets 6 measurements TOTAL (not per day) — a taste, not a tool.
    // The counter lives next to the demo data itself, so wiping it to cheat
    // also wipes everything the freeloader saved.
    if (!session && !DEMO_KEY) {
      if (demoUsed() >= 6) { setDemoCap(true); return; }
    }
    setAddrQ(addr);
    setMeasureCoords(gps ? { lat: gps.lat, lng: gps.lng } : null);
    setMeasuring(true);
    setMeasurePhase(0);
    const t0 = Date.now();
    const p1 = setTimeout(() => setMeasurePhase(1), 1000);
    const p2 = setTimeout(() => setMeasurePhase(2), 1900);
    // Ask the backend first (real APIs or server-side demo); if it's not
    // running, fall back to the in-app simulated lookup.
    let res = null;
    let answered = false;
    let noDataCoords = null;
    try {
      const r = await fetch("/api/lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session}` } : {}),
        },
        body: JSON.stringify(gps
          ? { lat: gps.lat, lng: gps.lng, parcel: trade === "fence", demo: DEMO_KEY }
          : { address: addr, placeId, parcel: trade === "fence", demo: DEMO_KEY }),
      });
      if (r.status === 429) {
        clearTimeout(p1); clearTimeout(p2);
        setMeasuring(false);
        // a signed-in client hitting their daily ceiling gets the plain toast;
        // a demo freeloader gets the conversion screen
        // paid accounts get a fair-use note, never public-demo conversion copy
        if (!session && !DEMO_KEY) setDemoCap(true); else showToast("🔒 " + (session ? t.fairUse : t.demoLimit));
        return;
      }
      if (r.ok) {
        const j = await r.json();
        answered = true;
        if (!session && !DEMO_KEY && j.found) {
          try { localStorage.setItem("alto_demo_meas", String((parseInt(localStorage.getItem("alto_demo_meas") || "0", 10) || 0) + 1)); } catch { /* private mode */ }
        }
        if (!j.found && j.lat != null) noDataCoords = { lat: j.lat, lng: j.lng, addr: j.addr || addr };
        res = j.found ? {
          addr: j.addr || addr, roofArea: j.roofArea, pitch: String(j.pitch || "6"),
          stories: j.stories || 1, sqft: j.sqft || 0, beds: j.beds, baths: j.baths,
          year: j.year, segments: j.segments || 1, source: j.source, estimated: j.estimated,
          lat: j.lat, lng: j.lng, segs: j.segs || [], bbox: j.bbox || null,
          imageryDate: j.imageryDate || null, imageryYear: j.imageryYear || null,
          quality: j.quality || null, outline: j.outline || null, parcel: j.parcel || null,
          parcelV2: j.parcelV2 || null, examples: j.examples || null,
          lowConf: !!j.lowConf, confReason: j.confReason || null,
        } : null;
      }
    } catch { /* backend unreachable */ }
    if (!answered) res = await mockLookup(addr);
    if (res && keepAddr && addr) res.addr = addr;
    // Keep the measuring animation on screen long enough to read
    await new Promise(rs => setTimeout(rs, Math.max(0, 2400 - (Date.now() - t0))));
    clearTimeout(p1); clearTimeout(p2);
    setMeasuring(false);
    if (trade === "fence") {
      const j = answered && res ? res : null;
      const pv = j?.parcelV2 || null;
      const pState = pv?.state || null;
      const base = (j && j.lat != null && { lat: j.lat, lng: j.lng, addr: j.addr, parcel: j.parcel || null })
        || noDataCoords
        // Demo-only fallback location. A PAYING account is NEVER teleported to
        // a fake address — if we truly don't know where the house is, say so.
        || (!session ? { lat: 26.3827418, lng: -98.8196915, addr } : null);
      if (!base) {
        showToast("⚠️ " + t.lookupFail);
        setScreen("calc");
        return;
      }
      // Parcel candidates → the CONFIRMATION step. The contractor never
      // measures until the right lot is confirmed (found = "¿es la correcta?",
      // ambiguous = tap the right one). Legacy single-parcel responses without
      // parcelV2 keep the old direct path.
      const cands = (pv?.candidates || []).filter((c) => (c.disp || c.raw || []).length >= 3);
      if ((pState === "found" || pState === "ambiguous") && cands.length) {
        setFConfirm({ state: pState, cands, sel: 0, addr: base.addr, lat: base.lat, lng: base.lng, examples: null });
        setScreen("fenceConfirm");
        showToast(pState === "found" ? "🛰️ " + t.parcelFound : "📍 " + t.parcelAmbig2);
        return;
      }
      // Anonymous demo with curated examples → example picker
      if (pState === "demo" && j?.examples?.length) {
        setFConfirm({ state: "demo", cands: [], examples: j.examples, sel: -1, addr: base.addr, lat: base.lat, lng: base.lng });
        setScreen("fenceConfirm");
        return;
      }
      setFConfirm(null);
      if (base.parcel && base.parcel.length >= 3) {
        openFence({ lat: base.lat, lng: base.lng, addr: base.addr, parcel: base.parcel, raw: base.parcel });
      } else {
        openFence({ lat: base.lat, lng: base.lng, addr: base.addr, zoom: 19, parcel: null });
      }
      // Honest, state-specific wording (#16): "parcela encontrada" when the
      // boundary loaded — never "cerca medida" before a route is selected —
      // and a provider outage is an outage, not "no hay línea de propiedad".
      showToast(
        base.parcel && base.parcel.length >= 3 ? "🛰️ " + t.parcelFound
          : pState === "provider_error" || pState === "rate_limited" ? "⚠️ " + t.parcelErr
          : pState === "demo" ? "✏️ " + t.parcelDemoDraw
          : "✏️ " + t.noParcel
      );
      return;
    }
    if (!res) {
      setLookup(null);
      if (noDataCoords) {
        // We know where the house is, just not its roof — let them trace it
        openTrace({ ...noDataCoords, zoom: 20 });
        showToast("✏️ " + t.noRoofTrace);
      } else {
        setScreen("calc");
        showToast("🛰️ " + t.noRoofData);
      }
      return;
    }
    setLookup(res);
    setShowDetails(false);
    setTakeoff(null); // takeoff belongs to one roof — never carry it over
    // Suggested squares = satellite area with the calibration bump; the waste
    // tier comes from how cut-up the satellite saw the roof to be.
    setMSq(String(Math.ceil((res.roofArea * SAT_CAL) / 100)));
    setRoofWaste(suggestWaste(res.segments, res.pitch));
    setPitch(res.pitch);
    setStories(String(res.stories));
    setFp(String(Math.round(res.sqft / res.stories)));
    setScreen("calc");
    showToast("🛰️ " + t.roofMeasured + " ✓");
  };

  const askAI = async (q) => {
    if (!q.trim() || aiBusy) return;
    const userMsg = { role: "user", content: q };
    const history = [...aiMsgs, userMsg];
    setAiMsgs(history);
    setAiInput("");
    setAiBusy(true);
    try {
      const data = {
        jobs: jobs.slice(0, 60).map(j => ({ customer: custOf(j).name, title: j.title[lang], total: j.amount, paid: j.paidAmt, status: j.status, daysOutstanding: daysOld(j) })),
        customers: customers.slice(0, 60).map(c2 => ({ name: c2.name, area: c2.addr || "" })),
        myPrices: { materials: myMaterials, laborPerSq: myPrices.labor, tearOffPerSq: myPrices.tear },
      };
      const res = await api("/api/ai", {
        method: "POST",
        body: JSON.stringify({ messages: history, lang, trade, bizName, data }),
      });
      const out = await res.json();
      const text = out.text || TR[lang].aiErr;
      setAiMsgs([...history, { role: "assistant", content: text }]);
    } catch {
      setAiMsgs([...history, { role: "assistant", content: TR[lang].aiErr }]);
    }
    setAiBusy(false);
  };

  /* ── Shell pieces ── */
  const LangToggle = () => (
    <div className="flex rounded-full overflow-hidden" style={{ border: `1.5px solid ${C.line}` }}>
      {[["es", "Español"], ["en", "English"]].map(([l, lb]) => (
        <button key={l} onClick={() => setLang(l)} className="px-4 py-2 font-extrabold"
          style={{ background: lang === l ? C.navy : "#fff", color: lang === l ? "#fff" : C.slate, border: "none", fontSize: 14 }}>{lb}</button>
      ))}
    </div>
  );

  // Big, impossible-to-miss back target; title centered with the logo. The
  // language toggle left the header — language is chosen at onboarding (and
  // changeable in Settings), so a stray tap can't flip someone's app.
  const Header = ({ title, back }) => {
    // Desktop: the sidebar already says where you are — slim left-aligned
    // title, no repeated logo, and top-level tabs drop the back button.
    if (deskShell) {
      const topLevel = ["jobs", "customers", "payments", "leads", "ai", "settings"].includes(screen);
      return (
        <div className="flex items-center gap-3 px-5 pt-5 pb-2">
          {!topLevel && back && (
            <button onClick={back} aria-label="back" className="dskrow rounded-lg shrink-0 flex items-center justify-center"
              style={{ width: 34, height: 34, background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy, fontSize: 19, fontWeight: 800, lineHeight: 1 }}>‹</button>
          )}
          <span className="font-bold truncate" style={{ color: C.navy, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 27 }}>{title}</span>
        </div>
      );
    }
    return (
    <div className="flex items-center gap-2 px-4 pt-4 pb-3">
      {back ? (
        <button onClick={back} aria-label="back" className="rounded-full active:scale-90 transition-transform shrink-0 flex items-center justify-center"
          style={{ width: 46, height: 46, background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy, fontSize: 26, fontWeight: 800, lineHeight: 1 }}>‹</button>
      ) : <span style={{ width: 46 }} />}
      <span className="flex-1 flex items-center justify-center gap-2 min-w-0">
        <Logo size={30} />
        <span className="font-bold truncate" style={{ color: C.navy, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22 }}>{title}</span>
      </span>
      <span style={{ width: 46 }} className="shrink-0" />
    </div>
    );
  };

  const BottomNav = () => (
    <div className="flex justify-around items-center py-2 px-2" style={{ background: "#fff", borderTop: `1px solid ${C.line}` }}>
      {[["home", "🏠", t.home], ["payments", "💵", t.navPays], ["settings", "⚙️", t.settings]].map(([s, icon, label]) => (
        <button key={s} onClick={() => setScreen(s)} className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg" style={{ background: "none", border: "none" }}>
          <span className="text-xl">{icon}</span>
          <span className="text-xs font-bold" style={{ color: screen === s ? C.orange : C.slate }}>{label}</span>
        </button>
      ))}
    </div>
  );

  // Desktop sidebar: the office shell. Same destinations as the phone (home
  // cards + bottom bar), one click each, with the contractor's brand on top
  // and the #1 rep action — a new estimate — always one click away.
  const SideNav = () => (
    <div className="flex flex-col flex-shrink-0" style={{ width: 232, background: "#fff", borderRight: `1px solid ${C.line}`, height: "100%" }}>
      <div className="px-5 pt-6 pb-4" style={{ borderBottom: `1px solid ${C.line}` }}>
        {logo
          ? <img src={logo} alt="" className="rounded-lg" style={{ maxHeight: 54, maxWidth: 170, display: "block" }} />
          : <img src="/brand-logo.png" alt="ALTO Pro" style={{ maxWidth: 150, display: "block" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />}
        {bizName && <p className="text-sm font-extrabold mt-2 truncate" style={{ color: C.navy }}>{bizName}</p>}
      </div>
      {(trade === "roofing" || trade === "fence") && (
        <div className="px-4 pt-4 pb-1">
          <button onClick={() => { setAddrQ(""); setPlaceSugs(null); setLookup(null); setScreen("roofAddress"); }}
            className="w-full rounded-xl py-3 text-sm font-extrabold active:scale-95"
            style={{ background: C.orange, color: C.navy, border: "none" }}>🛰️ {trade === "fence" ? t.measureFence : t.measureTitle}</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {[
          ["home", "🏠", t.home],
          ["jobs", "🔨", t.jobs],
          ["customers", "👤", t.customers],
          ["payments", "💵", t.navPays],
          ["leads", "📥", t.leads],
          ["ai", "💬", t.askTTP],
          ["settings", "⚙️", t.settings],
        ].map(([s, icon, label]) => (
          <button key={s} onClick={() => setScreen(s)}
            className="snv w-full flex items-center gap-3 rounded-xl px-3 py-2.5 mb-1 text-left"
            style={{ background: screen === s ? C.orangeSoft : "none", border: "none", cursor: "pointer" }}>
            <span className="text-lg">{icon}</span>
            <span className="text-sm font-bold flex items-center gap-2" style={{ color: screen === s ? C.orange : C.navy }}>
              {label}
              {s === "leads" && newLeadCount > 0 && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold" style={{ background: C.orange, color: "#fff" }}>{newLeadCount}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="px-5 py-4" style={{ borderTop: `1px solid ${C.line}` }}>
        <p className="text-xs font-bold truncate" style={{ color: C.slate }}>{userName || " "}</p>
        <p className="text-[10px] font-semibold" style={{ color: "#9AA3B2" }}>⚡ ALTO Pro</p>
      </div>
    </div>
  );

  /* ── Screens ── */
  // Self-signup is invite-only: a contractor can never type their info and
  // create an account here. The setup form shows ONLY to someone who arrived
  // with a personal invite link (session) or the owner's demo passcode; every
  // other visitor sees a locked "clients only" gate that points to sales.
  const canSetUp = !!session || !!DEMO_KEY;
  // Save everything the first-run wizard collected and never show it again.
  const finishOnboarding = () => {
    const mats = myMaterials.filter((m) => String(m.n).trim() !== "");
    const cleanMats = mats.length ? mats : myMaterials;
    setMyMaterials(cleanMats);
    saveProfile({ name: userName, biz: bizName, phone: userPhone, lang, prices: myPrices, materials: cleanMats, logo, setupDone: true });
    setSetupDone(true); // reaches the cloud via the save effect — no more re-onboarding
    setScreen("home");
  };
  // Unlock the locked screen by typing the demo password (validated server-side
  // against DEMO_PASS). On success we remember it and reopen straight into the app.
  const tryDemoPass = async (pass) => {
    if (!pass) return;
    setDemoErr(false);
    try {
      const r = await fetch("/api/demo-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pass }) });
      const j = await r.json().catch(() => ({}));
      if (j.ok) { try { localStorage.setItem("alto_demo_pass", pass); } catch { /* private mode */ } window.location.reload(); }
      else setDemoErr(true);
    } catch { setDemoErr(true); }
  };
  // The locked screen is a real login: a client pastes their WhatsApp access
  // link (the reliable way to log the installed home-screen app in on iOS),
  // and the owner's demo password still works through the same box.
  const gateSubmit = () => {
    const v = demoPass.trim();
    if (!v) return;
    setDemoErr(false);
    const m = v.match(/\/invite\/([A-Za-z0-9_-]+)/) || (/^[A-Za-z0-9_-]{20,}$/.test(v) ? [null, v] : null);
    if (m) { window.location.href = "/invite/" + m[1]; return; }
    tryDemoPass(v);  // not a link → try it as the owner demo password
  };
  const obH2 = "font-extrabold mb-1";
  const obH2Style = { color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26 };
  const obCard = { background: "#fff", border: `1.5px solid ${C.line}` };
  const Onboard = () => canSetUp ? (
    <div className="flex flex-col flex-1 px-6 pt-6 pb-6 overflow-y-auto"
      style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #EFF2F7 100%)" }}>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          {obStep > 0 && (
            <button onClick={() => setObStep(obStep - 1)} aria-label="back"
              className="w-9 h-9 rounded-full text-xl font-extrabold active:scale-90"
              style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy, lineHeight: 1 }}>‹</button>
          )}
          <img src="/brand-logo.png" alt="ALTO Pro" style={{ height: 32 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
        </div>
        {obStep > 0 && <button onClick={finishOnboarding} className="text-sm font-bold" style={{ background: "none", border: "none", color: C.slate }}>{t.obSkipAll}</button>}
      </div>
      <div className="flex justify-center gap-1.5 mb-7">
        {[0, 1, 2, 3].map((i) => <span key={i} style={{ width: i === obStep ? 22 : 8, height: 8, borderRadius: 99, background: i <= obStep ? C.orange : C.line, transition: "all .2s" }} />)}
      </div>
      {obStep === 0 && (
        <div className="mt-6">
          <p className="text-center text-sm font-semibold mb-1" style={{ color: C.slate }}>{t.obWelcome}</p>
          <h2 className="text-center font-extrabold mb-7" style={obH2Style}>{t.obLang}</h2>
          <div className="grid gap-3">
            <Btn onClick={() => { setLang("es"); setObStep(1); }}>🇲🇽 Español</Btn>
            <Btn color="#fff" textColor={C.navy} style={{ border: `1.5px solid ${C.line}` }} onClick={() => { setLang("en"); setObStep(1); }}>🇺🇸 English</Btn>
          </div>
        </div>
      )}
      {obStep === 1 && (
        <div>
          <h2 className={obH2} style={obH2Style}>{t.obBizQ}</h2>
          <p className="text-sm font-semibold mb-4" style={{ color: C.slate }}>{t.obBizHint}</p>
          <div className="rounded-2xl p-4" style={obCard}>
            <Field label={t.yourName} value={userName} onChange={setUserName} placeholder="José" />
            <div className="mt-3"><Field label={t.bizName} value={bizName} onChange={setBizName} placeholder={trade === "fence" ? "South Texas Fencing" : "South Texas Roofing"} /></div>
          </div>
          <div className="mt-6"><Btn onClick={() => setObStep(2)}>{t.continue}</Btn></div>
        </div>
      )}
      {obStep === 2 && (
        <div>
          <h2 className="font-extrabold mb-4" style={obH2Style}>{trade === "fence" ? t.obPricesFenceQ : t.obPricesQ}</h2>
          <div className="rounded-2xl p-4" style={obCard}>
            {myMaterials.map((m, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input value={m.n} onChange={(e) => updateMat(i, "n", e.target.value)} placeholder={t.matNameLbl}
                  className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ border: `1.5px solid ${C.line}`, outline: "none", color: C.navy }} />
                <div className="flex items-center rounded-xl px-2" style={{ border: `1.5px solid ${C.line}` }}>
                  <span style={{ color: C.slate, fontWeight: 800 }}>$</span>
                  <input type="number" inputMode="numeric" value={m.p} onChange={(e) => updateMat(i, "p", e.target.value)} className="w-14 py-2.5 text-right font-bold outline-none bg-transparent" style={{ color: C.navy }} />
                </div>
                <button onClick={() => removeMat(i)} className="text-lg font-bold px-1" style={{ background: "none", border: "none", color: C.red }}>✕</button>
              </div>
            ))}
            <button onClick={addMat} className="text-sm font-extrabold mb-3" style={{ background: "none", border: "none", color: C.orange, padding: 0 }}>+ {t.addMaterial}</button>
            <div className="grid grid-cols-2 gap-x-3 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
              {trade === "fence" ? (<>
                <Field label={t.walkPrice} value={myPrices.walkGate ?? ""} onChange={(v) => setMyPrices((pp) => ({ ...pp, walkGate: v }))} type="number" placeholder="250" />
                <Field label={t.dblPrice} value={myPrices.dblGate ?? ""} onChange={(v) => setMyPrices((pp) => ({ ...pp, dblGate: v }))} type="number" placeholder="450" />
              </>) : (<>
                <Field label={t.laborPerSq} value={myPrices.labor ?? ""} onChange={(v) => setMyPrices((pp) => ({ ...pp, labor: v }))} type="number" placeholder="150" />
                <Field label={t.tearPerSq} value={myPrices.tear ?? ""} onChange={(v) => setMyPrices((pp) => ({ ...pp, tear: v }))} type="number" placeholder="50" />
              </>)}
            </div>
          </div>
          <div className="mt-6"><Btn onClick={() => setObStep(3)}>{t.continue}</Btn></div>
        </div>
      )}
      {obStep === 3 && (
        <div>
          <h2 className="font-extrabold mb-4" style={obH2Style}>{t.obLogoQ}</h2>
          <div className="rounded-2xl p-5 flex flex-col items-center gap-3" style={obCard}>
            {logo && <img src={logo} alt="" style={{ maxHeight: 70, maxWidth: 200, background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 10, padding: 4 }} />}
            <label className="rounded-xl px-5 py-3 text-sm font-bold cursor-pointer" style={{ background: "#fff", border: `1.5px dashed ${C.orange}`, color: C.orange }}>
              {t.uploadLogo}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogoFile(e.target.files?.[0])} />
            </label>
            {logo && <button onClick={() => setLogo(null)} className="text-sm font-bold" style={{ background: "none", border: "none", color: C.slate }}>✕ {t.removeLogo}</button>}
          </div>
          <div className="mt-6"><Btn onClick={finishOnboarding}>{t.obFinish}</Btn></div>
        </div>
      )}
      <p className="text-center text-xs font-semibold mt-7" style={{ color: "#A9B1C2" }}>{t.obEditLater}</p>
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center flex-1 px-6 text-center"
      style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #EFF2F7 100%)" }}>
      <img src="/brand-logo.png" alt="ALTO Pro" style={{ maxWidth: 240, margin: "0 auto 6px" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
      <p className="mb-7 font-semibold" style={{ color: C.slate, fontSize: 15 }}>{t.welcome1} <span style={{ color: C.orange }}>{t.welcome2}</span></p>
      <div className="w-full rounded-3xl px-5 py-7 text-center"
        style={{ background: "#fff", boxShadow: "0 14px 40px rgba(16,27,48,.09)", border: "1px solid #EDF0F4" }}>
        <div className="text-4xl mb-3">🔑</div>
        <p className="text-base font-bold" style={{ color: C.navy }}>{t.loginTitle}</p>
        <p className="text-xs font-semibold mt-2" style={{ color: C.slate }}>{t.loginHint}</p>
        <div className="mt-4">
          <input type="text" value={demoPass} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setDemoPass(e.target.value); setDemoErr(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") gateSubmit(); }}
            placeholder={t.loginPlaceholder}
            className="w-full rounded-xl px-4 py-3 text-sm font-semibold"
            style={{ border: `1.5px solid ${demoErr ? C.red : C.line}`, outline: "none", textAlign: "center" }} />
          {demoErr && <p className="text-xs font-bold mt-1" style={{ color: C.red }}>{t.loginErr}</p>}
          <div className="mt-2"><Btn onClick={gateSubmit}>{t.enterBtn}</Btn></div>
        </div>
      </div>
      <div className="w-full mt-5">
        <Btn color="#fff" textColor={C.navy} style={{ border: `1.5px solid ${C.line}`, letterSpacing: "0.1em" }}
          onClick={() => { window.location.href = "https://alto-pro.com/ventas"; }}>{t.getStarted}</Btn>
      </div>
      <div className="mt-6"><LangToggle /></div>
      <p className="mt-6 text-xs font-semibold" style={{ color: "#A9B1C2", letterSpacing: "0.22em" }}>{t.madeFor}</p>
    </div>
  );

  const Settings = () => {
    const setPrice = (k, v) => {
      const next = { ...myPrices, [k]: v };
      setMyPrices(next);
      saveProfile({ prices: next });
    };
    const matLabel = { three: t.shingle3, arch: t.archShingle, metal: t.metalRoof, tile: t.tileRoof };
    // Accordion: one bold section open at a time — Ajustes reads like a menu,
    // not a mile-long scroll. Field state lives at the top level, so
    // collapsing a section never loses what was typed.
    const Sec = (id, icon, title, body) => {
      const on = setSec === id;
      return (
        <div className="rounded-2xl mb-3 overflow-hidden" style={{ background: "#fff", border: `1.5px solid ${on ? C.navy : C.line}` }}>
          <button onClick={() => setSetSec(on ? null : id)} className="w-full flex items-center gap-3 px-4 py-4 text-left" style={{ background: "none", border: "none" }}>
            <span className="text-xl">{icon}</span>
            <span className="font-extrabold flex-1" style={{ color: C.navy, fontSize: 15.5 }}>{title}</span>
            <span className="font-extrabold" style={{ color: C.slate }}>{on ? "▾" : "▸"}</span>
          </button>
          {on && <div className="px-4 pb-4">{body}</div>}
        </div>
      );
    };
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        <div className="rounded-2xl p-4 mb-3" style={{ background: pushOn ? "#EAF8EF" : "#fff", border: `1.5px solid ${pushOn ? "#34A853" : C.orange}` }}>
          <p className="text-sm font-extrabold" style={{ color: C.navy }}>🔔 {t.pushTitle}</p>
          <p className="text-xs mt-1 mb-3" style={{ color: C.slate }}>{t.pushDesc}</p>
          {pushOn
            ? <div className="flex items-center gap-3">
                <p className="text-sm font-bold flex-1" style={{ color: "#1E7B3C", margin: 0 }}>{t.pushOnLabel}</p>
                <button disabled={pushBusy} onClick={disablePush} className="text-xs font-extrabold rounded-xl px-3 py-2" style={{ background: "#F0F2F6", color: C.slate, border: "none" }}>{t.pushOff}</button>
              </div>
            : <Btn disabled={pushBusy} onClick={enablePush}>{t.pushEnable}</Btn>}
        </div>
        {(() => {
          const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone;
          const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
          if (deskShell) return null; // desktop: one primary CTA (avisos), no install pitch
          return (
            <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
              <p className="text-sm font-extrabold" style={{ color: C.navy }}>📲 {t.installTitle}</p>
              {standalone ? (
                <p className="text-sm font-bold mt-2" style={{ color: "#1E7B3C" }}>{t.installDone}</p>
              ) : (
                <>
                  <p className="text-xs mt-1 mb-2" style={{ color: C.slate }}>{t.installInstr}</p>
                  <Btn onClick={doInstall}>📲 {t.instBtn}</Btn>
                </>
              )}
            </div>
          );
        })()}
        {Sec("negocio", "🧑‍🔧", t.bizSection, <>
          <Field label={t.yourName} value={userName} onChange={setUserName} placeholder="Rolando" />
          <Field label={t.bizName} value={bizName} onChange={setBizName} placeholder={trade === "fence" ? "South Texas Fencing" : "South Texas Roofing"} />
          <Field label={t.phone} value={userPhone} onChange={setUserPhone} placeholder="(956) 555-0100" type="tel" />
          <Field label={t.emailLbl} value={bizEmail} onChange={setBizEmail} placeholder="garza@roofing.com" />
          <Field label={t.licenseLbl} value={license} onChange={setLicense} placeholder="RCAT-12345" />
        </>)}
        {Sec("marca", "🎨", t.brandSection, <>
          <p className="text-xs mb-3" style={{ color: C.slate }}>{t.brandHint}</p>
          <div className="flex items-center gap-3">
            {logo && <img src={logo} alt="" className="rounded-lg" style={{ maxHeight: 52, maxWidth: 150, background: "#fff", border: `1.5px solid ${C.line}`, padding: 3 }} />}
            <label className="rounded-xl px-4 py-3 text-sm font-bold cursor-pointer" style={{ background: "#fff", border: `1.5px dashed ${C.orange}`, color: C.orange }}>
              {logo ? "📷" : t.uploadLogo}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogoFile(e.target.files?.[0])} />
            </label>
            {logo && (
              <button onClick={() => { setLogo(null); logoIdRef.current = null; saveProfile({ logo: null }); }}
                className="text-sm font-bold" style={{ background: "none", border: "none", color: C.slate }}>✕ {t.removeLogo}</button>
            )}
          </div>
        </>)}
        {Sec("materiales", "🧱", t.materialsSection, <>
          <p className="text-xs mb-3" style={{ color: C.slate }}>{trade === "fence" ? t.materialsFenceHint : t.materialsHint}</p>
          {myMaterials.map((m, i) => (
            <div key={i} className="flex items-center gap-2 mb-2">
              <input value={m.n} onChange={(e) => updateMat(i, "n", e.target.value)} placeholder={t.matNameLbl}
                className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ border: `1.5px solid ${C.line}`, outline: "none", color: C.navy }} />
              <div className="flex items-center rounded-xl px-2" style={{ border: `1.5px solid ${C.line}` }}>
                <span style={{ color: C.slate, fontWeight: 800 }}>$</span>
                <input type="number" inputMode="numeric" value={m.p} onChange={(e) => updateMat(i, "p", e.target.value)}
                  className="w-16 py-2.5 text-right font-bold outline-none bg-transparent" style={{ color: C.navy }} />
              </div>
              <button onClick={() => removeMat(i)} className="text-lg font-bold px-1" style={{ background: "none", border: "none", color: C.red }}>✕</button>
            </div>
          ))}
          <button onClick={addMat} className="text-sm font-extrabold mb-3" style={{ background: "none", border: "none", color: C.orange, padding: 0 }}>+ {t.addMaterial}</button>
          <div className="grid grid-cols-2 gap-x-3 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
            {trade === "fence" ? (<>
              <Field label={t.walkPrice} value={myPrices.walkGate ?? ""} onChange={(v) => setPrice("walkGate", v)} type="number" placeholder="250" />
              <Field label={t.dblPrice} value={myPrices.dblGate ?? ""} onChange={(v) => setPrice("dblGate", v)} type="number" placeholder="450" />
            </>) : (<>
              <Field label={t.laborPerSq} value={myPrices.labor ?? ""} onChange={(v) => setPrice("labor", v)} type="number" placeholder="150" />
              <Field label={t.tearPerSq} value={myPrices.tear ?? ""} onChange={(v) => setPrice("tear", v)} type="number" placeholder="50" />
            </>)}
          </div>
          {trade === "fence" && <div className="mt-3"><FenceProductsCard /></div>}
        </>)}
        {Sec("propuesta", "📄", t.proposalSection, <>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.slate }}>{t.scopeLbl}</span>
            <button onClick={() => setScope(lang === "en" ? DEFAULT_SCOPE_EN : DEFAULT_SCOPE_ES)} className="text-xs font-extrabold" style={{ background: "none", border: "none", color: C.orange, padding: 0 }}>↻ {t.scopeReset}</button>
          </div>
          <textarea value={scope} onChange={(e) => setScope(e.target.value)} rows={6}
            className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ border: `1.5px solid ${C.line}`, outline: "none", color: C.navy, resize: "vertical", lineHeight: 1.5 }} />
          <button disabled={scopeAiBusy} onClick={async () => {
            // AI polish: same points, cleaner wording — lands back in the
            // textarea so the contractor always has the final word.
            setScopeAiBusy(true);
            try {
              const r = await api("/api/scopeai", { method: "POST", body: JSON.stringify({ text: scope, lang }) });
              const j = await r.json();
              if (j.text) { setScope(j.text); showToast("✨ ✓"); } else showToast(t.scopeAIFail);
            } catch { showToast(t.scopeAIFail); }
            setScopeAiBusy(false);
          }} className="w-full rounded-xl py-2.5 mt-2 text-sm font-extrabold active:scale-95 transition-transform"
            style={{ background: C.navy, color: "#fff", border: "none", opacity: scopeAiBusy ? 0.6 : 1 }}>{scopeAiBusy ? "…" : t.scopeAI}</button>
          <p className="text-xs mt-1 mb-3" style={{ color: C.slate }}>{t.scopeHint}</p>
          <div className="flex items-center justify-between py-2" style={{ borderTop: `1px solid ${C.line}` }}>
            <span className="text-sm font-bold" style={{ color: C.navy }}>🛡️ {t.warrantyTgl}</span>
            <button onClick={() => setWarrantyOn(!warrantyOn)} className="rounded-full w-14 h-8 flex items-center px-1 transition-all"
              style={{ background: warrantyOn ? C.orange : C.line, border: "none", justifyContent: warrantyOn ? "flex-end" : "flex-start" }}>
              <span className="w-6 h-6 rounded-full bg-white" style={{ boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
            </button>
          </div>
          {warrantyOn && <Field label={t.warrantyLbl} value={warrantyText} onChange={setWarrantyText} placeholder={t.warrantyPh} />}
        </>)}
        {Sec("pagos", "🏦", t.paySection, <>
          <Field label={t.zelleLbl} value={zelle} onChange={setZelle} placeholder={userPhone || "(956) 555-0100"} type="tel" />
          <p className="text-xs -mt-1 mb-1" style={{ color: C.slate }}>{t.zelleHint}</p>
        </>)}
        {session && Sec("ayuda", "🛠️", t.reqT, <>
            <p className="text-xs mb-2" style={{ color: C.slate }}>{t.reqSub}</p>
            <p className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: C.slate }}>{t.reqKindQ}</p>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {t.reqKinds.map(([v, lb]) => (
                <button key={v} onClick={() => setReqKind(v)}
                  className="rounded-lg px-1 py-2 text-xs font-bold active:scale-95 transition-transform"
                  style={{ background: reqKind === v ? C.navy : C.bg, color: reqKind === v ? "#fff" : C.slate, border: "none" }}>{lb}</button>
              ))}
            </div>
            <textarea value={reqText} onChange={(e) => setReqText(e.target.value)} rows={3} placeholder={t.reqPh} maxLength={600}
              className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ border: `1.5px solid ${C.line}`, outline: "none", color: C.navy, resize: "vertical", lineHeight: 1.5 }} />
            <div className="flex gap-2 mt-2">
              {/* Same Whisper mic as the quick invoice — speak the change,
                  the transcript lands in the box, review, send. */}
              <button onClick={() => recToggle((txt) => { setReqText((v) => (v ? v.trim() + " " : "") + txt); })}
                className="rounded-xl text-xl active:scale-90 transition-transform shrink-0" aria-label="speak request"
                style={{ width: 52, background: recState === "rec" ? C.red : C.bg, border: `1.5px solid ${recState === "rec" ? C.red : C.line}`,
                  animation: recState === "rec" ? "ttpPulse 1.2s ease-in-out infinite" : "none" }}>
                {recState === "busy" ? "⏳" : recState === "rec" ? "🔴" : "🎤"}
              </button>
              <button disabled={reqBusy || !reqText.trim()} onClick={async () => {
                setReqBusy(true);
                try {
                  const r = await api("/api/change-request", { method: "POST", body: JSON.stringify({ text: reqText, kind: reqKind }) });
                  if (r.ok) { setReqText(""); setReqKind("any"); showToast(t.reqSent); setMyReqsOpen(true); fetchMyReqs(); } else showToast(t.reqFail);
                } catch { showToast(t.reqFail); }
                setReqBusy(false);
              }} className="flex-1 rounded-xl py-2.5 text-sm font-extrabold active:scale-95 transition-transform"
                style={{ background: C.navy, color: "#fff", border: "none", opacity: reqBusy || !reqText.trim() ? 0.55 : 1 }}>{reqBusy ? "…" : t.reqBtn}</button>
            </div>
            {/* Their ticket history: what they asked, and whether it's done */}
            <button onClick={() => { const nx = !myReqsOpen; setMyReqsOpen(nx); if (nx && myReqs === null) fetchMyReqs(); }}
              className="w-full flex items-center gap-2 mt-3 pt-3 text-sm font-bold" style={{ background: "none", border: "none", borderTop: `1.5px solid ${C.line}`, color: C.navy, padding: "10px 0 0" }}>
              📋 {t.reqListT}{myReqs ? ` · ${myReqs.length}` : ""}
              <span className="ml-auto font-extrabold" style={{ color: C.slate }}>{myReqsOpen ? "▾" : "▸"}</span>
            </button>
            {myReqsOpen && (
              <div className="mt-1">
                {myReqs === null && <p className="text-sm font-semibold py-2" style={{ color: C.slate }}>…</p>}
                {myReqs && myReqs.length === 0 && <p className="text-sm font-semibold py-2" style={{ color: C.slate }}>{t.reqListEmpty}</p>}
                {(myReqs || []).map((tk) => {
                  const st = tk.status === "done" ? [t.reqStDone, "#1E9E5A", "#EAF8EF"] : tk.status === "doing" ? [t.reqStDoing, "#9A6E00", "#FFF8E1"] : [t.reqStOpen, C.slate, C.bg];
                  const d = new Date(tk.at);
                  return (
                    <div key={tk.id} className="flex items-start gap-2 py-2.5" style={{ borderBottom: `1px solid ${C.line}` }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: C.navy, lineHeight: 1.4 }}>{tk.note}</p>
                        <p className="text-xs font-semibold mt-0.5" style={{ color: C.slate }}>{Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "short", day: "numeric" })}</p>
                      </div>
                      <span className="rounded-full px-2.5 py-1 text-xs font-extrabold shrink-0" style={{ background: st[2], color: st[1] }}>{st[0]}</span>
                    </div>
                  );
                })}
              </div>
            )}
        </>)}
        {Sec("cuenta", "⚙️", t.acctSection, <>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-extrabold" style={{ color: C.navy }}>Idioma / Language</span>
            <LangToggle />
          </div>
          <p className="text-xs mt-2" style={{ color: "#A9B1C2" }}>ALTO Pro · v1.0</p>
        </>)}
        <Btn onClick={() => {
          // Drop blank materials; keep at least one so the picker always works.
          const cleanMats = myMaterials.filter((m) => String(m.n).trim() !== "");
          const mats = cleanMats.length ? cleanMats : DEFAULT_MATERIALS;
          setMyMaterials(mats);
          saveProfile({ name: userName, biz: bizName, phone: userPhone, lang, email: bizEmail, license, zelle, scope, warrantyOn, warrantyText, prices: myPrices, materials: mats });
          const sel = mats.find((m) => m.n === matName) || mats[0];
          setMatName(sel.n); setMatSq(String(sel.p));
          if (myPrices.labor != null && myPrices.labor !== "") setLabSq(String(myPrices.labor));
          if (myPrices.tear != null && myPrices.tear !== "") setTearSq(String(myPrices.tear));
          setScreen("home");
          showToast(t.saved + " ✓");
        }}>{t.save}</Btn>
      </div>
    );
  };

  const TradePicker = () => {
    const trades = [
      ["roofing", "🏠", t.roofing, true], ["concrete", "🏗️", t.concrete, true],
      ["fence", "🪵", t.fence, true], ["pressure", "💦", t.pressure, false],
      ["landscaping", "🌿", t.landscaping, false], ["painting", "🎨", t.painting, false],
      ["plumbing", "🔧", t.plumbing, false], ["electric", "⚡", t.electric, false],
    ];
    return (
      <div className="flex-1 px-5 pt-8">
        <div className="flex justify-center mb-3"><Logo size={56} /></div>
        <h2 className="text-center font-extrabold mb-6" style={{ color: C.navy, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 30 }}>{t.whichTrade}</h2>
        <div className="grid grid-cols-2 gap-3">
          {trades.map(([key, icon, label, active]) => (
            <button key={key} onClick={() => { if (active) { setTrade(key); saveProfile({ trade: key }); setScreen("home"); } }}
              className="rounded-2xl p-5 flex flex-col items-center gap-2 active:scale-95 transition-transform"
              style={{ background: "#fff", border: active ? `2px solid ${C.orange}` : `1.5px solid ${C.line}`, opacity: active ? 1 : 0.55 }}>
              <span className="text-4xl">{icon}</span>
              <span className="font-bold" style={{ color: C.navy, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 19 }}>{label}</span>
              {!active && <span className="text-xs font-semibold" style={{ color: C.slate }}>{t.soon}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const Home = () => (
    <div className="app-scroll flex-1 flex flex-col overflow-y-auto">
      {/* Desktop home = an overview, not a copy of the sidebar: greeting +
          the five numbers a contractor checks first thing in the morning. */}
      {deskShell && (() => {
        const now = new Date();
        const inM = (ts) => { const d = new Date(ts); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); };
        const mJobs = jobs.filter((j) => j.status !== "estimate" && inM(j.date || (j.id > 1e12 ? j.id : Date.now())));
        const mSold = mJobs.reduce((s, j) => s + (j.amount || 0), 0);
        const mPaid = mJobs.reduce((s, j) => s + (j.paidAmt || 0), 0);
        const nAct = jobs.filter((j) => j.status !== "paid" && j.status !== "estimate").length;
        const dateStr = now.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { weekday: "long", day: "numeric", month: "long" });
        return (
          <div className="px-5 pt-6">
            <div className="flex items-end justify-between gap-3">
              <p className="font-extrabold truncate" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 30, lineHeight: 1 }}>{t.hello}{userName ? `, ${userName}` : ""} 👋</p>
              <p className="text-sm font-semibold shrink-0" style={{ color: C.slate }}>{dateStr.charAt(0).toUpperCase() + dateStr.slice(1)}</p>
            </div>
            <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
              {[
                [t.soldLbl, fmt(mSold), C.navy, "payments"],
                [t.collectedLbl, fmt(mPaid), "#1E7B3C", "payments"],
                [t.statOwed, fmt(owed), owed > 0 ? C.red : C.slate, "payments"],
                [t.statActive, String(nAct), C.navy, "jobs"],
                [t.leads, String(newLeadCount), newLeadCount > 0 ? C.orange : C.navy, "leads"],
              ].map(([lb, v, col, dest], i) => (
                <button key={i} onClick={() => setScreen(dest)} className="dskrow rounded-2xl px-4 py-3 text-left" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
                  <span className="block text-[11px] font-bold tracking-wide uppercase truncate" style={{ color: C.slate }}>{lb}</span>
                  <span className="block font-extrabold mt-0.5" style={{ color: col, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26 }}>{v}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}
      {!deskShell && (
      <div className="px-5 pt-8 pb-7" style={{ background: C.navy }}>
        <div className="flex items-center justify-between gap-2">
          <img src="/brand-logo-white.png" alt="ALTO PRO" style={{ height: 62, display: "block", flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <span className="font-bold text-white text-right" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 28, lineHeight: 1.05 }}>{t.hello}{userName ? `, ${userName}` : ""} 👋</span>
        </div>
      </div>
      )}
      {(trade === "roofing" || trade === "fence") && (
        <div className="px-5 pt-5">
          <button onClick={() => { setAddrQ(""); setPlaceSugs(null); setLookup(null); setScreen("roofAddress"); }}
            className="alto-glow w-full rounded-2xl flex flex-col items-center justify-center gap-1 px-4 py-5 active:scale-95 transition-transform"
            style={{ background: "#fff", border: `2px solid ${C.orange}` }}>
            <span className="text-3xl">🛰️</span>
            <span className="font-extrabold text-center" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 30, lineHeight: 1.05, letterSpacing: ".01em" }}>{trade === "fence" ? t.measureFence : t.measureTitle}</span>
            <span className="text-sm font-semibold text-center" style={{ color: C.slate }}>{t.searchAddress}</span>
          </button>
        </div>
      )}
      {session && !isStandalone && !instHide && !deskShell && (
        <div className="px-5 pt-3">
          <div className="w-full rounded-2xl flex items-center gap-3 px-4 py-3" style={{ background: "#FEF5DC", border: "1.5px solid #F8B408" }}>
            <button onClick={doInstall} className="flex-1 min-w-0 flex items-center gap-3 text-left" style={{ background: "none", border: "none", padding: 0 }}>
              <span className="text-2xl">📲</span>
              <span className="min-w-0">
                <span className="block text-sm font-extrabold" style={{ color: C.navy }}>{t.instBanner}</span>
                <span className="block text-xs font-semibold" style={{ color: C.slate }}>{t.instBannerSub}</span>
              </span>
            </button>
            <button onClick={doInstall} className="rounded-xl px-3 py-2 text-xs font-extrabold active:scale-95" style={{ background: C.navy, color: "#F8B408", border: "none", whiteSpace: "nowrap" }}>{t.instBtn}</button>
            <button onClick={hideInstall} aria-label="cerrar" className="text-base font-bold px-1" style={{ background: "none", border: "none", color: C.slate }}>✕</button>
          </div>
        </div>
      )}
      {(session || leads.length > 0) && (!deskShell || newLeadCount > 0) && (
        <div className="px-5 pt-3">
          <button onClick={() => setScreen("leads")}
            className="w-full rounded-2xl flex items-center gap-3 px-4 py-4 active:scale-95 transition-transform"
            style={{ background: newLeadCount > 0 ? C.navy : "#fff", border: newLeadCount > 0 ? "none" : `1.5px solid ${C.line}`, boxShadow: newLeadCount > 0 ? "0 6px 16px rgba(16,27,48,.3)" : "none" }}>
            <span className="text-2xl">📥</span>
            <span className="font-extrabold" style={{ color: newLeadCount > 0 ? "#fff" : C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{t.leads}</span>
            {newLeadCount > 0 && (
              <span className="ml-auto rounded-full px-3 py-1 text-sm font-extrabold" style={{ background: C.orange, color: "#fff" }}>{newLeadCount} {t.leadNew}</span>
            )}
            {newLeadCount === 0 && <span className="ml-auto text-xl" style={{ color: C.slate }}>→</span>}
          </button>
        </div>
      )}
      <div className="px-5 pt-5 grid grid-cols-2 gap-3" style={deskShell ? { gridTemplateColumns: "repeat(4,1fr)" } : undefined}>
        {[
          ["🌐", t.webPage, t.webPageSub, () => setScreen("webShare")],
          // Quick invoice up front — the old manual quick-quote was redundant:
          // typing the address in Medir techo generates the quote for you.
          ["🎤", t.quickInvoice, t.voiceSub, () => { setViHeard(""); setViName(""); setViConcept(""); setViAmount(""); setViLines([]); setViAddr(""); setViLoc(null); setScreen("voiceInvoice"); }],
          ["🔨", t.jobs, t.jobsSub, () => setScreen("jobs")],
          ["👤", t.customers, t.custSub, () => setScreen("customers")],
        ].map(([icon, label, sub, fn], i) => (
          <button key={i} onClick={fn} className="rounded-2xl flex flex-col items-start text-left gap-1 px-4 py-4 active:scale-95 transition-transform"
            style={{ background: "#fff", color: C.navy, minHeight: deskShell ? 108 : 126, border: `1.5px solid ${C.line}`, boxShadow: "0 1px 2px rgba(16,27,48,.04)" }}>
            <span className="text-2xl mb-1">{icon}</span>
            <span className="font-extrabold" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19 }}>{label}</span>
            <span className="text-xs font-semibold" style={{ color: C.slate, lineHeight: 1.35 }}>{sub}</span>
          </button>
        ))}
      </div>
      {/* The AI assistant: full-width but slim and white like every other
          card — the orange hero and NUEVO badge keep the spotlight. */}
      <div className="px-5 pt-3">
        <button onClick={() => setScreen("ai")}
          className="w-full rounded-2xl flex items-center gap-3 px-4 py-3.5 active:scale-95 transition-transform text-left"
          style={{ background: "#fff", border: `1.5px solid ${C.line}`, boxShadow: "0 1px 2px rgba(16,27,48,.04)" }}>
          <span className="text-2xl">💬</span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold" style={{ color: C.navy, fontSize: 16 }}>{t.askTTP}</span>
            <span className="block text-xs font-semibold" style={{ color: C.slate }}>{trade === "fence" ? t.aiSubFence : t.aiSub}</span>
          </span>
          <span className="text-xl" style={{ color: C.slate }}>→</span>
        </button>
      </div>
      <div className="px-5 mt-4 grid gap-3">
        {[].map(([icon, label, sub, isNew, fn], i) => (
          <button key={i} onClick={fn} className="w-full rounded-2xl flex items-center gap-3 px-4 py-3.5 active:scale-95 transition-transform"
            style={{ background: "#FFFBF0", border: `1px solid ${C.orangeSoft}` }}>
            <span className="rounded-full flex items-center justify-center shrink-0" style={{ width: 44, height: 44, background: C.orange, fontSize: 20 }}>{icon}</span>
            <span className="text-left">
              <span className="flex items-center gap-2">
                <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19 }}>{label}</span>
                {isNew && <span className="rounded px-1.5 py-0.5 text-[10px] font-extrabold" style={{ background: C.navy, color: "#fff" }}>{t.newBadge}</span>}
              </span>
              <span className="block text-xs font-semibold" style={{ color: C.slate }}>{sub}</span>
            </span>
            <span className="ml-auto text-xl" style={{ color: C.slate }}>→</span>
          </button>
        ))}
      </div>
    </div>
  );

  const Calc = () => (
    <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
      <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label={t.length} value={L} onChange={setL} type="number" />
          <Field label={t.width} value={W} onChange={setW} type="number" />
          <Field label={t.thickness} value={TH} onChange={setTH} type="number" />
          <Field label={t.waste} value={waste} onChange={setWaste} type="number" suffix="%" />
        </div>
      </div>
      <div className="rounded-2xl p-4 mb-4" style={{ background: C.navy }}>
        <p className="text-xs font-bold tracking-widest mb-2" style={{ color: C.orange }}>{t.result}</p>
        {[[t.cubicYards, calc.yards.toFixed(2)], [t.withWaste, calc.withWaste.toFixed(2)], [t.order, calc.orderY + " yd³"], [t.trucks + " (10 yd³)", calc.trucks]].map(([k, v]) => (
          <div key={k} className="flex justify-between py-1">
            <span className="text-sm font-semibold" style={{ color: "#9DA8C4" }}>{k}</span>
            <span className="font-extrabold text-white" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{v}</span>
          </div>
        ))}
      </div>
      <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
        <p className="text-xs font-bold tracking-widest mb-2" style={{ color: C.slate }}>{t.optPrice}</p>
        <div className="grid grid-cols-2 gap-x-3">
          <Field label={t.pricePerYard} value={ppy} onChange={setPpy} type="number" />
          <Field label={t.laborSqFt} value={laborRate} onChange={setLaborRate} type="number" />
        </div>
        <div className="flex justify-between py-1"><span className="text-sm font-semibold" style={{ color: C.slate }}>{t.material} ({calc.orderY} yd³)</span><span className="font-bold" style={{ color: C.navy }}>{fmt(calc.mat)}</span></div>
        <div className="flex justify-between py-1"><span className="text-sm font-semibold" style={{ color: C.slate }}>{t.labor} ({calc.sqft} sq ft)</span><span className="font-bold" style={{ color: C.navy }}>{fmt(calc.lab)}</span></div>
        <div className="flex justify-between pt-2 mt-1" style={{ borderTop: `1.5px solid ${C.line}` }}>
          <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{t.estTotal}</span>
          <span className="font-extrabold" style={{ color: C.orange, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24 }}>{fmt(calc.total)}</span>
        </div>
      </div>
      <Btn onClick={() => {
        setPendingEstimate({
          title: lang === "es" ? `Losa ${L}×${W}, ${TH}″` : `Slab ${L}×${W}, ${TH}″`,
          lines: [["lineSlab", Math.round(calc.mat)], ["labor", Math.round(calc.lab)]],
          total: Math.round(calc.total),
        });
        setScreen("pickCustomer");
      }} disabled={calc.total <= 0}>{t.toEstimate}</Btn>
    </div>
  );

  const RoofAddress = () => {
    if (measuring) {
      // Fence lookups locate a PROPERTY, not a roof — never "Midiendo el techo"
      const phases = trade === "fence"
        ? [t.fMeasuring1, t.fMeasuring2, t.fMeasuring3]
        : [t.measuring1, t.measuring2, t.measuring3];
      return (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="relative w-full rounded-2xl overflow-hidden mb-5" style={{ aspectRatio: "400/188", maxWidth: 360, boxShadow: "0 12px 30px rgba(16,27,48,.18)", background: C.navyDeep }}>
            <RoofScanArt />
            {measureCoords && (
              <img src={`/api/roofimg?lat=${measureCoords.lat}&lng=${measureCoords.lng}&zoom=19`} alt=""
                className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", animation: "altoReveal 1.6s ease-out both" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }} />
            )}
            <div className="alto-scanbar" />
            <span className="absolute" style={{ top: 8, left: 11, fontSize: 22, filter: "drop-shadow(0 2px 4px rgba(0,0,0,.4))" }}>🛰️</span>
          </div>
          <p className="font-bold mb-5 truncate w-full" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22 }}>{addrQ}</p>
          <div className="text-left">
            {phases.map((ph, i) => (
              <p key={ph} className="py-1 font-semibold" style={{ color: i < measurePhase ? C.green : i === measurePhase ? C.navy : C.line }}>
                {i < measurePhase ? "✓ " : i === measurePhase ? "● " : "○ "}{ph}
              </p>
            ))}
          </div>
        </div>
      );
    }
    const q = addrQ.trim().toLowerCase();
    // Real accounts suggest the contractor's own customers. The demo suggests
    // nothing local — sample RGV addresses look fake to a prospect in another
    // city; they type their real address and Google autocomplete takes over.
    const localPool = session ? [...new Set(customers.map(c => c.addr).filter(Boolean))] : [];
    // Live suggestions are already filtered/ranked by Google — don't re-filter them
    const matches = placeSugs !== null
      ? placeSugs
      : localPool.filter(a => !q || a.toLowerCase().includes(q)).map(a => ({ text: a, placeId: null }));
    const custom = addrQ.trim() && !matches.some(m => m.text.toLowerCase() === q) ? addrQ.trim() : null;
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex items-center gap-2 rounded-2xl px-4 mb-2" style={{ background: "#fff", border: `2px solid ${C.orange}` }}>
          <span className="text-xl">🛰️</span>
          <input value={addrQ} onChange={(e) => onAddrInput(e.target.value)} placeholder={t.searchAddress} autoFocus
            onKeyDown={(e) => e.key === "Enter" && (custom ? startLookup(custom) : matches[0] && startLookup(matches[0].text, matches[0].placeId))}
            className="flex-1 min-w-0 py-4 text-lg font-semibold outline-none bg-transparent" style={{ color: C.navy }} />
          {hasVoice && (
            <button onClick={() => startVoice(onAddrInput)} className="text-2xl active:scale-90 transition-transform"
              style={{ background: "none", border: "none", opacity: listening ? 1 : 0.65 }}>{listening ? "🔴" : "🎤"}</button>
          )}
        </div>
        <button onClick={useMyLocation}
          className="alto-glow w-full rounded-2xl px-4 py-4 mt-2 flex items-center gap-3 active:scale-95 transition-transform"
          style={{ background: "#fff", border: `2px solid ${C.orange}` }}>
          <span className="text-2xl">📍</span>
          <span className="text-left">
            <span className="block font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, lineHeight: 1.05 }}>{t.useMyLocation}</span>
            <span className="block text-xs font-semibold" style={{ color: C.slate }}>{t.atTheHouse}</span>
          </span>
          <span className="ml-auto text-xs font-extrabold px-2.5 py-1 rounded-full" style={{ background: C.orange, color: "#fff", letterSpacing: ".05em" }}>GPS</span>
        </button>
        {(custom || matches.length > 0) && (
          <p className="text-xs font-bold tracking-widest mb-2 mt-4" style={{ color: C.slate }}>{t.suggestions}</p>
        )}
        {custom && (
          <button onClick={() => startLookup(custom)} className="w-full rounded-2xl p-4 mb-2 flex items-center gap-3 text-left active:scale-95 transition-transform"
            style={{ background: C.orangeSoft, border: `1.5px solid ${C.orange}` }}>
            <span className="text-xl">📍</span>
            <span className="font-bold" style={{ color: C.navy }}>{t.useThisAddr}: {custom}</span>
          </button>
        )}
        {matches.map(m => (
          <button key={m.text} onClick={() => startLookup(m.text, m.placeId)} className="w-full rounded-2xl p-4 mb-2 flex items-center gap-3 text-left active:scale-95 transition-transform"
            style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
            <span className="text-xl">📍</span>
            <span className="font-semibold" style={{ color: C.navy }}>{m.text}</span>
          </button>
        ))}
      </div>
    );
  };

  /* "Wrong house" fix: the geocoder pin sometimes lands on the neighbor's
   * roof (rural addresses). Show the neighborhood; one tap on the correct
   * roof re-runs the whole measurement at that exact spot. */
  const PickHouse = () => {
    if (!pickBase) return null;
    const tap = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * TRACE_W;
      const y = ((e.clientY - r.top) / r.height) * TRACE_H;
      const [la, ln] = pxToLl(x, y, pickBase);
      setScreen("roofAddress"); // shows the measuring animation
      startLookup(pickBase.addr || addrQ, null, { lat: la, lng: ln }, true);
    };
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        <div className="rounded-xl px-3 py-2 mb-2.5 flex items-center gap-2" style={{ background: C.orangeSoft, border: `1.5px solid ${C.orange}` }}>
          <span className="text-base">👆</span>
          <span className="text-xs font-bold" style={{ color: "#8A5A00", lineHeight: 1.35 }}>{t.pickHouseHint}</span>
        </div>
        <div className="relative rounded-2xl overflow-hidden mb-2" style={{ width: "100%", aspectRatio: "1280/800", background: C.navyDeep }}>
          <img src={`/api/roofimg?lat=${pickBase.lat}&lng=${pickBase.lng}&zoom=${pickBase.zoom}`} alt=""
            className="absolute inset-0 w-full h-full" style={{ cursor: "crosshair" }} onClick={tap}
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPickBase({ ...pickBase, zoom: Math.max(16, pickBase.zoom - 1) })}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy }}>− {t.pickZoomOut}</button>
          <button onClick={() => setPickBase({ ...pickBase, zoom: Math.min(21, pickBase.zoom + 1) })}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy }}>+ {t.pickZoomIn}</button>
        </div>
      </div>
    );
  };

  const Trace = () => {
    if (!traceBase) return null;
    // Real Google map first; on any failure it flips gmapOff and we render the
    // classic image trace below — so the map can never strand the user.
    if (mapsKey && !gmapOff) {
      return (
        <TraceErrorBoundary onError={(e) => { setGmapErr("error: " + ((e && e.message) || "")); setGmapOff(true); }}>
          <GoogleMapTrace base={traceBase} mapsKey={mapsKey} lang={lang} t={t}
            pitchFactor={PITCH_FACTORS[pitch] || 1.118} pitch={pitch} onPitchChange={setPitch}
            onApply={(secs) => applyTrace(secs)} onFallback={(why) => { setGmapErr(why === "manual" ? "" : (why || "")); setGmapOff(true); }} />
        </TraceErrorBoundary>
      );
    }
    const allSecs = traceCur.length >= 3 ? [...traceSecs, traceCur] : traceSecs;
    const fp = Math.round(allSecs.reduce((s, p) => s + traceAreaSqft(p), 0));
    const factor = PITCH_FACTORS[pitch] || 1.118;
    const area = Math.round(fp * factor);
    const squares = Math.ceil(area / 100);
    const sq = traceMode === "squares";
    const natOf = (e) => { const r = e.currentTarget.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * TRACE_W, ((e.clientY - r.top) / r.height) * TRACE_H]; };
    const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) c = !c; } return c; };
    const cen = (px) => [px.reduce((s, p) => s + p[0], 0) / px.length, px.reduce((s, p) => s + p[1], 0) / px.length];
    const rotPx = (px) => { const c = cen(px); const top = px.reduce((m, p) => p[1] < m[1] ? p : m, px[0]); return [c[0], top[1] - 64]; };
    // drop a ready-made rectangle in the middle of the view; the user nudges it
    const addSquare = () => { const cx = TRACE_W / 2, cy = TRACE_H / 2, w = 360, h = 260; const corners = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]].map(([x, y]) => pxToLl(x, y, traceBase)); setTraceSecs([...traceSecs, corners]); setSelSq(traceSecs.length); };
    const setMode = (m) => { if (m === "squares") { if (traceCur.length >= 3) setTraceSecs([...traceSecs, traceCur]); setTraceCur([]); } setSelSq(null); setTraceMode(m); };
    const delSel = () => { if (selSq != null) { setTraceSecs(traceSecs.filter((_, i) => i !== selSq)); setSelSq(null); } };
    const clearAll = () => { setTraceSecs([]); setTraceCur([]); setSelSq(null); };
    // Points mode: tap = add a point, drag = pan. Squares mode: move / reshape / rotate boxes.
    const onDown = (e) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      if (sq) {
        const [nx, ny] = natOf(e);
        if (selSq != null && traceSecs[selSq]) {
          const px = proj(traceSecs[selSq]);
          const rh = rotPx(px);
          if (Math.hypot(nx - rh[0], ny - rh[1]) < 36) { const c = cen(px); sqDrag.current = { type: "rotate", idx: selSq, cx: c[0], cy: c[1], a0: Math.atan2(ny - c[1], nx - c[0]), base: traceSecs[selSq] }; tracePtr.current = { live: 1 }; return; }
          for (let i = 0; i < px.length; i++) if (Math.hypot(nx - px[i][0], ny - px[i][1]) < 36) { sqDrag.current = { type: "corner", idx: selSq, ci: i }; tracePtr.current = { live: 1 }; return; }
        }
        for (let s = traceSecs.length - 1; s >= 0; s--) if (inPoly([nx, ny], proj(traceSecs[s]))) { setSelSq(s); sqDrag.current = { type: "body", idx: s, last: [nx, ny] }; tracePtr.current = { live: 1 }; return; }
        setSelSq(null); sqDrag.current = null; tracePtr.current = { x: e.clientX, y: e.clientY, moved: false };
        return;
      }
      sqDrag.current = null;
      tracePtr.current = { x: e.clientX, y: e.clientY, moved: false };
    };
    const onMove = (e) => {
      if (!tracePtr.current) return;
      const d = sqDrag.current;
      if (d) {
        const [nx, ny] = natOf(e);
        if (d.type === "corner") { const secs = traceSecs.map(s => s.slice()); secs[d.idx][d.ci] = pxToLl(nx, ny, traceBase); setTraceSecs(secs); }
        else if (d.type === "body") { const a = pxToLl(nx, ny, traceBase), b = pxToLl(d.last[0], d.last[1], traceBase); const dlat = a[0] - b[0], dlng = a[1] - b[1]; const secs = traceSecs.map(s => s.slice()); secs[d.idx] = secs[d.idx].map(([la, ln]) => [la + dlat, ln + dlng]); setTraceSecs(secs); d.last = [nx, ny]; }
        else if (d.type === "rotate") { const da = Math.atan2(ny - d.cy, nx - d.cx) - d.a0, cs = Math.cos(da), sn = Math.sin(da); const secs = traceSecs.map(s => s.slice()); secs[d.idx] = d.base.map((ll) => { const [x, y] = llToPx(ll, traceBase); return pxToLl(d.cx + (x - d.cx) * cs - (y - d.cy) * sn, d.cy + (x - d.cx) * sn + (y - d.cy) * cs, traceBase); }); setTraceSecs(secs); }
        return;
      }
      const dx = e.clientX - tracePtr.current.x, dy = e.clientY - tracePtr.current.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) tracePtr.current.moved = true;
      if (tracePtr.current.moved) setDragOff([dx, dy]);
    };
    const onUp = (e) => {
      const start = tracePtr.current, d = sqDrag.current;
      tracePtr.current = null; sqDrag.current = null;
      if (d) return;
      if (!start) return;
      const rect = e.currentTarget.getBoundingClientRect();
      if (start.moved) {
        const [dxN, dyN] = [((e.clientX - start.x) / rect.width) * TRACE_W, ((e.clientY - start.y) / rect.height) * TRACE_H];
        const [lat, lng] = pxToLl(TRACE_W / 2 - dxN, TRACE_H / 2 - dyN, traceBase);
        setDragOff([0, 0]); setTraceBase({ ...traceBase, lat, lng });
      } else if (!sq) {
        const [x, y] = [((e.clientX - rect.left) / rect.width) * TRACE_W, ((e.clientY - rect.top) / rect.height) * TRACE_H];
        setTraceCur([...traceCur, pxToLl(x, y, traceBase)]);
      }
    };
    const zoomBy = (d) => {
      const z = Math.min(Math.max(traceBase.zoom + d, 16), 21);
      if (z !== traceBase.zoom) setTraceBase({ ...traceBase, zoom: z });
    };
    const undo = () => {
      if (traceCur.length) setTraceCur(traceCur.slice(0, -1));
      else if (traceSecs.length) { setTraceCur(traceSecs[traceSecs.length - 1]); setTraceSecs(traceSecs.slice(0, -1)); }
    };
    const closeSection = () => {
      if (traceCur.length >= 3) { setTraceSecs([...traceSecs, traceCur]); setTraceCur([]); }
    };
    const proj = (pts) => pts.map(p => llToPx(p, traceBase));
    const ptsStr = (pts) => proj(pts).map(p => `${p[0]},${p[1]}`).join(" ");
    const curPx = proj(traceCur);
    // Two-finger pan/pinch + wheel-zoom, wrapping the single-finger handlers.
    const rMap = makeMapHandlers({ down: onDown, move: onMove, up: onUp }, traceBase, setTraceBase, TRACE_W, TRACE_H,
      () => { tracePtr.current = null; sqDrag.current = null; setDragOff([0, 0]); });
    const rWrap = mapXform
      ? { transform: `translate(${mapXform.tx}px, ${mapXform.ty}px) scale(${mapXform.scale})`, transformOrigin: `${mapXform.ox}px ${mapXform.oy}px` }
      : { transform: `translate(${dragOff[0]}px, ${dragOff[1]}px)` };
    // live edge lengths, like a tape measure
    const edgeLabels = (pts, px, closed) => {
      const out = [];
      const n = closed ? pts.length : pts.length - 1;
      if (n < 1) return out;
      const cx = px.reduce((s, p) => s + p[0], 0) / px.length;
      const cy = px.reduce((s, p) => s + p[1], 0) / px.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % pts.length;
        const ft = distFt(pts[i], pts[j]);
        const [pa, pb] = [px[i], px[j]];
        const sl = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        if (ft < 3 || sl < 55) continue;
        const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
        let nx = -(pb[1] - pa[1]) / sl, ny = (pb[0] - pa[0]) / sl;
        if ((mx + nx * 42 - cx) ** 2 + (my + ny * 42 - cy) ** 2 < (mx - nx * 42 - cx) ** 2 + (my - ny * 42 - cy) ** 2) { nx = -nx; ny = -ny; }
        out.push({ x: mx + nx * 42, y: my + ny * 42 + 14, ft: Math.round(ft) });
      }
      return out;
    };
    const ftText = (l, i) => (
      <text key={"ft" + i} x={l.x} y={l.y} textAnchor="middle" fontSize="46" fontWeight="800"
        fill={C.navy} stroke="#fff" strokeWidth="10" paintOrder="stroke"
        fontFamily="'Barlow Condensed',sans-serif">{l.ft}′</text>
    );
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        {gmapErr ? (
          <div className="rounded-xl px-3 py-2 mt-1 mb-2.5 text-xs font-bold" style={{ background: C.redSoft, color: C.red, lineHeight: 1.4 }}>
            ⚠️ {lang === "es" ? "El mapa real de Google no cargó" : "The real Google map didn't load"} — <span style={{ fontWeight: 700 }}>{gmapErr}</span>
          </div>
        ) : null}
        {/* Pick the method first, then trace */}
        <p className="text-xs font-bold tracking-widest mt-1 mb-2" style={{ color: C.slate }}>{t.howMeasure}</p>
        <div className="flex gap-2 mb-2.5">
          <button onClick={() => setMode("points")} className="flex-1 rounded-xl px-2 py-2.5 active:scale-95 transition-transform"
            style={{ background: !sq ? C.orange : "#fff", border: `2px solid ${!sq ? C.orange : C.line}`, color: !sq ? "#fff" : C.navy }}>
            <span className="block font-extrabold" style={{ fontSize: 15 }}>👆 {t.pressArea}</span>
            <span className="block text-xs font-semibold" style={{ opacity: .82 }}>{t.pressAreaSub}</span>
          </button>
          <button onClick={() => setMode("squares")} className="flex-1 rounded-xl px-2 py-2.5 active:scale-95 transition-transform"
            style={{ background: sq ? C.orange : "#fff", border: `2px solid ${sq ? C.orange : C.line}`, color: sq ? "#fff" : C.navy }}>
            <span className="block font-extrabold" style={{ fontSize: 15 }}>⬛ {t.makeSquares}</span>
            <span className="block text-xs font-semibold" style={{ opacity: .82 }}>{t.makeSquaresSub}</span>
          </button>
        </div>
        <div className="rounded-xl px-3 py-2 mb-2.5 flex items-center gap-2" style={{ background: C.orangeSoft, border: `1.5px solid ${C.orange}` }}>
          <span className="text-base">👆</span>
          <span className="text-xs font-bold" style={{ color: "#8A5A00", lineHeight: 1.35 }}>{mapPan ? t.panHint : sq ? t.sqHint : t.traceHint}</span>
        </div>
        <div className="relative rounded-2xl overflow-hidden mb-3" style={{ aspectRatio: "1280/800", background: C.navyDeep, cursor: "crosshair", touchAction: "none" }}
          data-map="roof" onWheel={rMap.onWheel} onPointerDown={rMap.onPointerDown} onPointerMove={rMap.onPointerMove} onPointerUp={rMap.onPointerUp} onPointerCancel={rMap.onPointerUp}>
          <div className="absolute inset-0" style={rWrap}>
            {!traceNoImg && (
              <img src={`/api/roofimg?lat=${traceBase.lat}&lng=${traceBase.lng}&zoom=${traceBase.zoom}`} alt=""
                className="absolute inset-0 w-full h-full" draggable={false}
                onError={() => setTraceNoImg(true)} />
            )}
            {traceNoImg && (
              <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold" style={{ color: "#9DA8C4", backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 19px, rgba(255,255,255,.08) 20px), repeating-linear-gradient(90deg, transparent, transparent 19px, rgba(255,255,255,.08) 20px)" }}>DEMO</div>
            )}
            <svg viewBox={`0 0 ${TRACE_W} ${TRACE_H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
              {traceSecs.map((sec, i) => {
                const px = proj(sec);
                return (
                  <g key={i}>
                    <polygon points={px.map(p => `${p[0]},${p[1]}`).join(" ")} fill="rgba(248,180,8,.22)" stroke={C.orange} strokeWidth="5" />
                    <text x={px.reduce((s, p) => s + p[0], 0) / px.length} y={px.reduce((s, p) => s + p[1], 0) / px.length}
                      textAnchor="middle" fill="#fff" fontSize="44" fontWeight="800" stroke={C.navyDeep} strokeWidth="2">{i + 1}</text>
                  </g>
                );
              })}
              {curPx.length > 1 && <polyline points={curPx.map(p => `${p[0]},${p[1]}`).join(" ")} fill="none" stroke={C.orange} strokeWidth="5" strokeDasharray="14 10" />}
              {curPx.length >= 3 && (
                <line x1={curPx[curPx.length - 1][0]} y1={curPx[curPx.length - 1][1]} x2={curPx[0][0]} y2={curPx[0][1]}
                  stroke={C.orange} strokeWidth="3" strokeDasharray="6 12" opacity=".6" />
              )}
              {curPx.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={i === 0 ? 14 : 10} fill={i === 0 ? C.orange : "#fff"} stroke={C.orange} strokeWidth="4" />
              ))}
              {traceSecs.map((sec, i) => edgeLabels(sec, proj(sec), true).map(ftText))}
              {traceCur.length > 1 && edgeLabels(traceCur, curPx, traceCur.length >= 3).map(ftText)}
              {sq && selSq != null && traceSecs[selSq] && (() => {
                const px = proj(traceSecs[selSq]); const c = cen(px); const rh = rotPx(px);
                return (<g>
                  <polygon points={px.map(p => `${p[0]},${p[1]}`).join(" ")} fill="rgba(248,180,8,.12)" stroke={C.orange} strokeWidth="6" />
                  <line x1={c[0]} y1={c[1]} x2={rh[0]} y2={rh[1]} stroke={C.orange} strokeWidth="4" />
                  <circle cx={rh[0]} cy={rh[1]} r="24" fill="#fff" stroke={C.orange} strokeWidth="5" />
                  <text x={rh[0]} y={rh[1] + 10} textAnchor="middle" fontSize="30" fill={C.orange}>↻</text>
                  {px.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="20" fill="#fff" stroke={C.orange} strokeWidth="6" />)}
                </g>);
              })()}
            </svg>
          </div>
          <div className="absolute right-2 top-2 flex flex-col gap-1.5" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
            <button onClick={() => setMapPan(!mapPan)} className="w-11 h-11 rounded-full text-lg active:scale-90"
              style={{ background: mapPan ? C.orange : "rgba(255,255,255,.92)", border: "none", boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>✋</button>
            <button onClick={() => zoomBy(1)} className="w-11 h-11 rounded-full text-xl font-extrabold active:scale-90"
              style={{ background: "rgba(255,255,255,.92)", border: "none", color: C.navy, boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>+</button>
            <button onClick={() => zoomBy(-1)} className="w-11 h-11 rounded-full text-xl font-extrabold active:scale-90"
              style={{ background: "rgba(255,255,255,.92)", border: "none", color: C.navy, boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>−</button>
          </div>
          {/* live count as you trace */}
          <div className="absolute left-2 top-2 rounded-full px-3.5 py-1.5 font-extrabold flex items-baseline gap-1"
            style={{ background: C.orange, color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,.3)", pointerEvents: "none" }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>{squares}</span>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{lang === "es" ? "cuadros" : "squares"}</span>
          </div>
        </div>
        <div className="flex gap-2 mb-3">
          {sq ? (<>
            <button onClick={addSquare} className="flex-1 rounded-xl py-2.5 text-sm font-bold active:scale-95 transition-transform" style={{ background: C.orangeSoft, border: `1.5px solid ${C.orange}`, color: C.orange }}>{t.addSquare}</button>
            <button onClick={delSel} disabled={selSq == null} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${selSq == null ? C.line : C.red}`, color: selSq == null ? C.slate : C.red }}>{t.delShape}</button>
            <button onClick={clearAll} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.red }}>{t.clearAll}</button>
          </>) : (<>
            <button onClick={undo} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy }}>{t.undo}</button>
            <button onClick={clearAll} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.red }}>{t.clearAll}</button>
            <button onClick={closeSection} disabled={traceCur.length < 3}
              className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: traceCur.length >= 3 ? C.orangeSoft : "#fff", border: `1.5px solid ${traceCur.length >= 3 ? C.orange : C.line}`, color: traceCur.length >= 3 ? C.orange : C.slate }}>{t.closeSection}</button>
          </>)}
        </div>
        <Sel label={t.pitch} value={pitch} onChange={setPitch} options={Object.keys(PITCH_FACTORS).map(p => [p, `${p}/12`])} />
        <div className="rounded-2xl p-4 mb-4 flex items-center justify-between" style={{ background: C.navy }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: "#9DA8C4" }}>{t.tracedArea}: <span className="font-extrabold text-white">{fp.toLocaleString()} sq ft</span></p>
            <p className="text-sm font-semibold mt-0.5" style={{ color: "#9DA8C4" }}>{t.roofArea} ({pitch}/12): <span className="font-extrabold text-white">{area.toLocaleString()} sq ft</span></p>
          </div>
          <div className="text-right shrink-0 pl-3">
            <p className="font-extrabold text-white" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 44, lineHeight: 1 }}>{squares}</p>
            <p className="text-xs font-extrabold tracking-widest" style={{ color: C.orange }}>{lang === "es" ? "CUADROS" : "SQUARES"}</p>
          </div>
        </div>
        <Btn onClick={applyTrace} disabled={fp === 0}>{t.useMeasure}</Btn>
      </div>
    );
  };

  const RoofCalc = () => {
    // Effective line amounts: computed by the engine, but any line the roofer
    // edits on the quote screen overrides it for this job (ov.*).
    const eMat = ov.mat != null ? ov.mat : roofCalc.matCost;
    const eLab = ov.lab != null ? ov.lab : roofCalc.labCost;
    const eTear = !tearOff ? 0 : (ov.tear != null ? ov.tear : roofCalc.tearCost);
    const eAcc = ov.acc != null ? ov.acc : roofCalc.acc;
    const eTotal = eMat + eLab + eTear + eAcc;
    const breakdownRows = [[t.lineRoof, "mat", roofCalc.matCost], [t.labor, "lab", roofCalc.labCost], ...(tearOff ? [[t.tearOffLine, "tear", roofCalc.tearCost]] : []), [t.accessories, "acc", roofCalc.acc]];
    // Honest, per-measurement confidence — never a blanket accuracy claim
    const acc = (() => {
      if (!lookup) return null;
      if (lookup.source === "trace") return { txt: t.accTraced, bg: C.orangeSoft, fg: C.orange };
      if (lookup.estimated) return { txt: t.accEst, bg: C.yellowSoft, fg: C.yellow };
      if (lookup.source !== "live") return null;
      const old = lookup.imageryYear && new Date().getFullYear() - lookup.imageryYear >= 5;
      if (lookup.quality === "HIGH" && !old) return { txt: t.accHigh, bg: C.greenSoft, fg: C.green };
      if (old) return { txt: t.accOld, bg: C.yellowSoft, fg: C.yellow };
      return { txt: t.accMed, bg: C.yellowSoft, fg: C.yellow };
    })();
    // Finish inline price editing: clean up, save (same place Settings saves to),
    // and refresh the selected material's price so the total updates.
    const finishEditPrices = () => {
      let mats = myMaterials
        .map((m) => ({ n: String(m.n || "").trim(), p: Math.max(0, Math.round(parseFloat(m.p) || 0)) }))
        .filter((m) => m.n);
      if (!mats.length) mats = DEFAULT_MATERIALS;
      setMyMaterials(mats);
      saveProfile({ materials: mats });
      const sel = mats.find((m) => m.n === matName) || mats[0];
      setMatName(sel.n); setMatSq(String(sel.p)); setOv((o) => ({ ...o, mat: undefined }));
      setEditPrices(false);
    };
    // Waste tier — how much extra material the cuts eat. Auto-suggested from
    // the satellite (sections + pitch); one tap to override. Shared by both views.
    const wasteChips = (
      <div className="rounded-2xl px-4 py-3 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold tracking-widest" style={{ color: C.slate }}>{t.wasteTitle.toUpperCase()}</span>
          <span className="font-extrabold" style={{ color: C.orange, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18 }}>+{roofWaste}%</span>
        </div>
        <div className="flex gap-1.5">
          {[[10, t.wasteT10], [12, t.wasteT12], [15, t.wasteT15], [20, t.wasteT20]].map(([v, lb]) => (
            <button key={v} onClick={() => setRoofWaste(v)} className="flex-1 rounded-xl px-1 py-2 active:scale-95 transition-transform"
              style={{ background: roofWaste === v ? C.orange : C.bg, border: `1.5px solid ${roofWaste === v ? C.orange : C.line}`, color: roofWaste === v ? "#fff" : C.navy }}>
              <span className="block text-xs font-extrabold">{lb}</span>
              <span className="block font-bold" style={{ fontSize: 11, opacity: .85 }}>{v}%</span>
            </button>
          ))}
        </div>
      </div>
    );
    // Material picker + inline price editor — shared by the measured view and the
    // manual quote, so prices can be edited the same way in both.
    const materialPicker = (
      <>
        {editPrices && (
          <div className="rounded-xl px-3 py-2 mb-2 text-xs font-bold" style={{ background: C.orangeSoft, color: "#8A5A00" }}>
            ✏️ {t.editHint}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-2">
          {myMaterials.map((m, i) => (
            editPrices ? (
              <div key={i} className="relative rounded-xl px-2.5 py-2.5" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
                {myMaterials.length > 1 && (
                  <button onClick={() => removeMat(i)} aria-label="remove"
                    className="absolute flex items-center justify-center active:scale-90"
                    style={{ top: -7, right: -7, width: 21, height: 21, borderRadius: 999, background: "#fff", color: C.slate, border: `1.5px solid ${C.line}`, fontSize: 13, lineHeight: 1, fontWeight: 800, zIndex: 2 }}>×</button>
                )}
                <input value={m.n} onChange={(e) => updateMat(i, "n", e.target.value)} placeholder={t.matNameLbl}
                  className="block w-full text-sm font-extrabold outline-none bg-transparent mb-1.5" style={{ color: C.navy, minWidth: 0 }} />
                <div className="alto-editfield rounded-lg px-2 py-1 inline-flex items-center">
                  <span className="font-bold text-xs" style={{ color: C.orange }}>$</span>
                  <input type="number" inputMode="numeric" value={m.p} onChange={(e) => updateMat(i, "p", e.target.value)}
                    className="text-center font-extrabold outline-none bg-transparent" style={{ color: C.orange, fontSize: 15, width: 44, minWidth: 0 }} />
                  <span className="font-bold text-xs" style={{ color: C.orange }}>/sq</span>
                </div>
              </div>
            ) : (
              <button key={i} onClick={() => { setMatName(m.n); setMatSq(String(m.p)); setOv((o) => ({ ...o, mat: undefined })); }}
                className="rounded-xl py-2.5 px-3 text-left active:scale-95"
                style={{ background: matName === m.n ? C.orangeSoft : "#fff", border: matName === m.n ? `2px solid ${C.orange}` : `1.5px solid ${C.line}` }}>
                <span className="block text-sm font-extrabold" style={{ color: matName === m.n ? C.orange : C.navy }}>{m.n || "—"}</span>
                <span className="block text-xs font-bold" style={{ color: C.slate }}>{fmt(m.p)}/sq</span>
              </button>
            )
          ))}
          {editPrices && (
            <button onClick={addMat} className="rounded-xl py-2 px-3 flex items-center justify-center active:scale-95"
              style={{ background: "#fff", border: `2px dashed ${C.orange}`, color: C.orange, fontWeight: 800, fontSize: 14, minHeight: 66 }}>
              + {t.addMaterial}
            </button>
          )}
        </div>
        <button onClick={() => { if (editPrices) finishEditPrices(); else setEditPrices(true); }}
          className="w-full rounded-xl py-2.5 mb-3 font-extrabold active:scale-95 transition-transform"
          style={editPrices
            ? { background: C.orange, color: "#fff", border: "none", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 17, letterSpacing: "0.03em" }
            : { background: "#fff", color: C.slate, border: `1.5px solid ${C.line}`, fontSize: 14 }}>
          {editPrices ? `✓ ${t.donePrices}` : `✏️ ${t.editPrices}`}
        </button>
      </>
    );
    const toEstimate = () => {
      let title = (lang === "es" ? "Techo " : "Roof ") + matName + `, ${roofCalc.squares} sq, ${pitch}/12`;
      if (lookup) title += " — " + lookup.addr.split(",")[0];
      const lines = [["lineRoof", Math.round(eMat)], ["accessories", Math.round(eAcc)]];
      if (tearOff) lines.push(["tearOffLine", Math.round(eTear)]);
      lines.push(["labor", Math.round(eLab)]);
      const est = {
        title, lines, total: Math.round(eTotal), addr: lookup ? lookup.addr : "",
        meas: lookup && lookup.lat != null ? {
          lat: lookup.lat, lng: lookup.lng, bbox: lookup.bbox,
          outline: lookup.outline ? lookup.outline.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]) : null,
          roofArea: Math.round(lookup.roofArea), pitch: lookup.pitch, squares: roofCalc.squares,
          waste: roofWaste, segments: lookup.segments || 1,
          imageryDate: lookup.imageryDate || null,
          streetDate: streetMeta && streetMeta.ok && streetMeta.date ? streetMeta.date : null,
        } : null,
      };
      if (leadCustRef.current) { const cid = leadCustRef.current; leadCustRef.current = null; createEstimate(cid, est); return; }
      setPendingEstimate(est);
      setScreen("pickCustomer");
    };
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        {lookup ? (
          <div style={deskShell ? { display: "grid", gridTemplateColumns: "minmax(0,1fr) 420px", gap: 20, alignItems: "start" } : undefined}>
          <div>
            {/* The answer, nothing else: photo → squares → material → total → send */}
            <div className="rounded-2xl p-3 mb-3" style={{ background: C.navy }}>
              <div className="flex items-center justify-between mb-2 gap-2">
                <p className="font-bold text-white truncate" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 17 }}>{lookup.addr}</p>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={{
                    background: lookup.source === "live" ? "rgba(30,158,90,.25)" : lookup.source === "trace" ? "rgba(248,180,8,.25)" : "rgba(255,255,255,.12)",
                    color: lookup.source === "live" ? "#7BE3A8" : lookup.source === "trace" ? "#FFC08A" : "#9DA8C4",
                  }}>{lookup.source === "live" ? "LIVE" : lookup.source === "trace" ? t.traced : "DEMO"}</span>
              </div>
              {lookup.lat != null && (() => {
                // Dimensioned diagram: plain photo + SVG outline with edge lengths
                const o = lookup.outline;
                // Squares + pitch right on the picture, so it reads as a measurement card.
                const measOverlay = (
                  <div className="absolute left-0 right-0 bottom-0 flex flex-wrap items-center gap-1.5 px-2.5 py-2"
                    style={{ background: "linear-gradient(to top, rgba(11,19,34,.9), rgba(11,19,34,0))" }}>
                    <span className="rounded-lg px-2.5 py-1 font-extrabold" style={{ background: C.orange, color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19, lineHeight: 1 }}>{roofCalc.squares} {lang === "es" ? "CUADROS" : "SQUARES"}</span>
                    <span className="rounded-lg px-2.5 py-1 font-extrabold" style={{ background: "rgba(255,255,255,.95)", color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19, lineHeight: 1 }}>{lookup.pitch}/12</span>
                    <span className="rounded-lg px-2 py-1 font-bold" style={{ background: "rgba(255,255,255,.16)", color: "#fff", fontSize: 12 }}>{Math.round(lookup.roofArea).toLocaleString()} sq ft</span>
                  </div>
                );
                if (!o || o.length < 3) {
                  return (
                    <div className="alto-reveal relative w-full rounded-xl mb-1.5 overflow-hidden" style={{ border: "1px solid rgba(255,255,255,.15)" }}>
                      <img src={`/api/roofimg?lat=${lookup.lat}&lng=${lookup.lng}` + (lookup.bbox ? `&bbox=${lookup.bbox.join(",")}` : "")}
                        alt="" className="w-full" style={{ display: "block" }}
                        onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      {measOverlay}
                    </div>
                  );
                }
                const view = lookup.bbox
                  ? { lat: (lookup.bbox[0] + lookup.bbox[2]) / 2, lng: (lookup.bbox[1] + lookup.bbox[3]) / 2, zoom: zoomForBbox(lookup.bbox) }
                  : { lat: lookup.lat, lng: lookup.lng, zoom: 20 };
                const px = o.map(p => llToPx(p, view));
                const cx = px.reduce((s, p) => s + p[0], 0) / px.length;
                const cy = px.reduce((s, p) => s + p[1], 0) / px.length;
                const kR = Math.PI / 180, RE = 6378137;
                const labels = [];
                for (let i = 0; i < o.length; i++) {
                  const a = o[i], b = o[(i + 1) % o.length];
                  const ft = Math.hypot((b[1] - a[1]) * kR * RE * Math.cos(a[0] * kR), (b[0] - a[0]) * kR * RE) * 3.28084;
                  const [pa, pb] = [px[i], px[(i + 1) % px.length]];
                  const screenLen = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
                  if (ft < 6 || screenLen < 70) continue;
                  const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
                  let nx = -(pb[1] - pa[1]) / screenLen, ny = (pb[0] - pa[0]) / screenLen;
                  // point the label away from the roof's center
                  if ((mx + nx * 48 - cx) ** 2 + (my + ny * 48 - cy) ** 2 < (mx - nx * 48 - cx) ** 2 + (my - ny * 48 - cy) ** 2) { nx = -nx; ny = -ny; }
                  labels.push({ x: mx + nx * 48, y: my + ny * 48 + 15, ft: Math.round(ft) });
                }
                return (
                  <div className="alto-reveal relative w-full rounded-xl mb-1.5 overflow-hidden" style={{ aspectRatio: "1280/800", border: "1px solid rgba(255,255,255,.15)", background: C.navyDeep }}>
                    <img src={`/api/roofimg?lat=${view.lat}&lng=${view.lng}&zoom=${view.zoom}`} alt=""
                      className="absolute inset-0 w-full h-full" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    <svg viewBox={`0 0 ${TRACE_W} ${TRACE_H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
                      <polygon points={px.map(p => `${p[0]},${p[1]}`).join(" ")} fill="rgba(248,180,8,.12)" stroke="#fff" strokeWidth="7" strokeLinejoin="round" />
                      <polygon points={px.map(p => `${p[0]},${p[1]}`).join(" ")} fill="none" stroke={C.orange} strokeWidth="3.5" strokeLinejoin="round" />
                      {labels.map((l, i) => (
                        <text key={i} x={l.x} y={l.y} textAnchor="middle" fontSize="46" fontWeight="800"
                          fill={C.navy} stroke="#fff" strokeWidth="10" paintOrder="stroke"
                          fontFamily="'Barlow Condensed',sans-serif">{l.ft}′</text>
                      ))}
                    </svg>
                    {measOverlay}
                  </div>
                );
              })()}
              <p className="text-xs font-semibold" style={{ color: "#9DA8C4" }}>
                {lookup.source === "trace"
                  ? `✏️ ${t.tracedNote}`
                  : `🛰️ ${t.sourceNote}${lookup.imageryDate ? ` · ${lookup.imageryDate}` : ""} · ⚠️ ${t.shortVerify}`}
              </p>
              {lookup.source !== "trace" && lookup.lat != null && (
                <button onClick={() => { setPickBase({ lat: lookup.lat, lng: lookup.lng, zoom: 18, addr: lookup.addr }); setScreen("pickHouse"); }}
                  className="w-full rounded-xl py-2.5 mt-2 text-sm font-extrabold active:scale-95 transition-transform"
                  style={{ background: "rgba(255,255,255,.08)", border: "1.5px solid rgba(255,255,255,.28)", color: "#fff" }}>
                  🏠 {t.wrongHouseBtn}
                </button>
              )}
              {lookup.lat != null && (() => {
                const openReport = async (tkData) => {
                  const d = {
                    biz: bizName || "", ph: userPhone || "", em: bizEmail || undefined, lic: license || undefined,
                    lg: (await ensureLogoId()) || undefined,
                    addr: lookup.addr, la: lookup.lat, ln: lookup.lng, bb: lookup.bbox || undefined,
                    o: lookup.outline ? lookup.outline.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]).slice(0, 60) : undefined,
                    ra: Math.round(lookup.roofArea), pi: lookup.pitch, sq: roofCalc.squares, w: roofWaste, msq: roofCalc.matSquares,
                    seg: lookup.segments || 1, id: lookup.imageryDate || undefined,
                    sd: (streetMeta && streetMeta.ok && streetMeta.date) || undefined,
                    src: lookup.source, lang, dt: new Date().toLocaleDateString(lang === "es" ? "es-MX" : "en-US"),
                    tk: tkData ? {
                      e: tkData.totals.eave, rk: tkData.totals.rake, rd: tkData.totals.ridge,
                      hp: tkData.totals.hip, vl: tkData.totals.valley, cf: tkData.coverage, im: tkData.im || undefined,
                      ot: (tkData.outlineTypes || []).map((x) => (x === "rake" ? 1 : 0)),
                      ln: (tkData.lines || []).slice(0, 40).map((l) => [l.t[0], l.a[0], l.a[1], l.b[0], l.b[1], l.ft]),
                    } : undefined,
                  };
                  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
                  window.location.href = "/r?d=" + b64 + "&app=1";
                };
                return (
                  <>
                    <button onClick={() => openReport(takeoff)}
                      className="w-full rounded-xl py-2.5 mt-2 text-sm font-extrabold active:scale-95 transition-transform"
                      style={{ background: "rgba(255,255,255,.08)", border: "1.5px solid rgba(255,255,255,.28)", color: "#fff" }}>
                      📄 {t.reportBtn}
                    </button>
                    {tkOn && lookup.source === "live" && (
                      <button onClick={async () => {
                        if (tkBusy) return;
                        let tkData = takeoff;
                        if (!tkData) {
                          setTkBusy(true);
                          try {
                            const r = await api("/api/takeoff", {
                              method: "POST",
                              body: JSON.stringify({ lat: lookup.lat, lng: lookup.lng, bbox: lookup.bbox || undefined, outline: lookup.outline || undefined, demo: DEMO_KEY }),
                            });
                            if (r.ok) {
                              const j = await r.json();
                              if (j.ok === false) {
                                setTkBusy(false);
                                showToast(`⚠️ ${t.tkLowData}${j.quality ? ` (${j.quality}${j.res ? ` · ${Math.round(j.res * 100)}cm/px` : ""})` : ""}.`);
                                return;
                              }
                              tkData = j; setTakeoff(j);
                            }
                          } catch { /* offline */ }
                          setTkBusy(false);
                          if (!tkData) { showToast("⚠️ " + t.tkErr); return; }
                        }
                        openReport(tkData);
                      }}
                        className="w-full rounded-xl py-2.5 mt-2 text-sm font-extrabold active:scale-95 transition-transform"
                        style={{ background: "rgba(255,255,255,.08)", border: "1.5px solid rgba(255,255,255,.28)", color: "#fff", opacity: tkBusy ? .6 : 1 }}>
                        📐 {tkBusy ? "…" : t.tkBtn}
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          <div>
            {lookup.lowConf && lookup.source !== "trace" && lookup.lat != null && lookup.confReason === "approx_pin" && (
              <div className="rounded-2xl p-3 mb-3" style={{ background: "#FFF4E0", border: `1.5px solid ${C.orange}` }}>
                <p className="text-sm font-extrabold mb-1" style={{ color: "#8A5A00" }}>⚠️ {t.pinMaybeWrong}</p>
                <p className="text-xs font-semibold mb-2" style={{ color: "#8A6D2A", lineHeight: 1.5 }}>{t.pinMaybeWrongSub}</p>
                <button onClick={() => { setPickBase({ lat: lookup.lat, lng: lookup.lng, zoom: 18, addr: lookup.addr }); setScreen("pickHouse"); }}
                  className="w-full rounded-xl py-3 font-extrabold active:scale-95 transition-transform"
                  style={{ background: C.orange, color: "#fff", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 17, letterSpacing: "0.04em" }}>
                  🏠 {t.wrongHouseBtn}
                </button>
              </div>
            )}
            {lookup.lowConf && lookup.source !== "trace" && lookup.lat != null && lookup.confReason !== "approx_pin" && (
              <div className="rounded-2xl p-3 mb-3" style={{ background: "#FFF4E0", border: `1.5px solid ${C.orange}` }}>
                <p className="text-sm font-extrabold mb-1" style={{ color: "#8A5A00" }}>⚠️ {t.measMaybeOff}</p>
                <p className="text-xs font-semibold mb-2" style={{ color: "#8A6D2A", lineHeight: 1.5 }}>{t.measMaybeOffSub}</p>
                <button onClick={() => { setTraceMode("squares"); setSelSq(null); openTrace({ lat: lookup.lat, lng: lookup.lng, zoom: lookup.bbox ? zoomForBbox(lookup.bbox) : 20, addr: lookup.addr, outline: lookup.outline || null }); }}
                  className="w-full rounded-xl py-3 font-extrabold active:scale-95 transition-transform"
                  style={{ background: C.orange, color: "#fff", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 17, letterSpacing: "0.04em" }}>
                  ⬛ {t.measManualBtn}
                </button>
              </div>
            )}
            {acc && (
              <div className="rounded-xl px-3 py-2 mb-3 text-center text-xs font-bold" style={{ background: acc.bg, color: acc.fg }}>
                {acc.txt}
              </div>
            )}
            {lookup.lat != null && (() => {
              // House front (Street View) as its own small row — kept OFF the satellite
              // so it never covers the roof. Photo + address + the year it was taken;
              // tap to enlarge. Shows "No exterior view" where Google has no coverage.
              const svUrl = `/api/streetview?lat=${lookup.lat}&lng=${lookup.lng}`;
              const svYear = streetMeta && streetMeta.date ? String(streetMeta.date).slice(0, 4) : null;
              const noView = streetMeta && streetMeta.ok === false;
              const street = (lookup.addr ? lookup.addr.split(",")[0] : "") || (lang === "es" ? "La casa" : "The home");
              return (
                <div className="rounded-2xl p-2.5 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
                  <div className="flex items-center gap-3">
                    <button type="button" disabled={noView} onClick={() => { if (!noView) setZoomPhoto(svUrl); }}
                      className="shrink-0 rounded-xl overflow-hidden relative active:scale-95 transition-transform"
                      style={{ width: 66, height: 66, padding: 0, border: `1.5px solid ${C.line}`, background: C.bg }}>
                      <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: 27, opacity: 0.8 }}>🏠</div>
                      {!noView && (
                        <img src={svUrl} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold truncate" style={{ color: C.navy }}>{street}</p>
                      <p className="text-xs font-semibold mt-0.5" style={{ color: C.slate }}>
                        {noView
                          ? (lang === "es" ? "Sin vista exterior" : "No exterior view")
                          : `📷 ${lang === "es" ? "Foto del exterior" : "Exterior photo"}${svYear ? ` · ${svYear}` : ""}`}
                      </p>
                    </div>
                    {!noView && <span style={{ color: C.slate, fontSize: 17, paddingRight: 4 }}>⤢</span>}
                  </div>
                  {/* the drive there lives WITH the house photo (owner's call) */}
                  <button onClick={() => driveTo(lookup.addr, lookup.lat, lookup.lng)}
                    className="w-full rounded-xl py-2.5 mt-2.5 text-sm font-extrabold active:scale-95 transition-transform"
                    style={{ background: C.bg, border: "none", color: C.navy }}>
                    🗺️ {t.directions}
                  </button>
                </div>
              );
            })()}
            <div className="rounded-2xl px-4 py-3 mb-3 text-center" style={{ background: "#fff", border: `2px solid ${C.orange}` }}>
              <p className="text-xs font-bold tracking-widest" style={{ color: C.slate }}>{t.squares.toUpperCase()}</p>
              <div className="flex items-center justify-center gap-5">
                <button onClick={() => setMSq(String(Math.max(1, (parseInt(mSq) || 1) - 1)))}
                  className="w-12 h-12 rounded-full text-2xl font-extrabold active:scale-95"
                  style={{ background: C.bg, border: `1.5px solid ${C.line}`, color: C.navy }}>−</button>
                <input value={mSq} onChange={(e) => setMSq(e.target.value)} inputMode="numeric"
                  className="w-24 text-center font-extrabold outline-none bg-transparent"
                  style={{ color: C.navy, fontSize: 54, fontFamily: "'Barlow Condensed',sans-serif" }} />
                <button onClick={() => setMSq(String((parseInt(mSq) || 0) + 1))}
                  className="w-12 h-12 rounded-full text-2xl font-extrabold active:scale-95"
                  style={{ background: C.bg, border: `1.5px solid ${C.line}`, color: C.navy }}>+</button>
              </div>
              <p className="text-sm font-semibold" style={{ color: C.slate }}>{Math.round(lookup.roofArea).toLocaleString()} sq ft · {lookup.pitch}/12</p>
            </div>
            <p className="text-xs font-semibold mb-3 px-1 text-center" style={{ color: C.slate, lineHeight: 1.45 }}>{t.approxNote}</p>
            {lookup.lat != null && (
              <button onClick={() => openTrace({ lat: lookup.lat, lng: lookup.lng, zoom: lookup.bbox ? zoomForBbox(lookup.bbox) : 20, addr: lookup.addr, outline: lookup.outline || null })}
                className="w-full rounded-2xl py-3 mb-3 font-bold active:scale-95 transition-transform"
                style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 17, letterSpacing: "0.04em" }}>
                {t.verifyBtn}
              </button>
            )}
            {materialPicker}
            {wasteChips}
            {/* Tear-off on/off right in the fast view — an overlay job has none. */}
            <div className="rounded-2xl px-4 py-3 mb-3 flex items-center justify-between" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
              <span className="text-sm font-bold" style={{ color: C.navy }}>{t.tearOff}</span>
              <div className="flex items-center gap-3">
                {tearOff && <select value={layers} onChange={(e) => setLayers(e.target.value)} className="rounded-lg px-2 py-1.5 font-bold outline-none" style={{ background: C.bg, border: `1.5px solid ${C.line}`, color: C.navy }}>
                  {[["1", "1"], ["2", "2"], ["3", "3"]].map(([v, l]) => <option key={v} value={v}>{t.layers}: {l}</option>)}
                </select>}
                <button onClick={() => setTearOff(!tearOff)} className="rounded-full w-14 h-8 flex items-center px-1 transition-all"
                  style={{ background: tearOff ? C.orange : C.line, border: "none", justifyContent: tearOff ? "flex-end" : "flex-start" }}>
                  <span className="w-6 h-6 rounded-full bg-white" style={{ boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
                </button>
              </div>
            </div>
            {/* Breakdown — in edit mode every line (labor, tear-off…) lights up editable. */}
            <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
              {breakdownRows.map(([label, key, base]) => (
                <div key={key} className="flex items-center justify-between py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
                  <span className="text-sm font-bold" style={{ color: C.navy }}>{label}</span>
                  <div className={`flex items-center ${editPrices ? "alto-editfield rounded-lg px-2 py-0.5" : ""}`}>
                    <span style={{ color: editPrices ? C.orange : C.slate, fontWeight: 800 }}>$</span>
                    <input type="number" inputMode="numeric" readOnly={!editPrices}
                      value={ov[key] != null ? ov[key] : Math.round(base)}
                      onChange={(e) => { const v = e.target.value; setOv((o) => ({ ...o, [key]: v === "" ? 0 : Math.max(0, Math.round(parseFloat(v) || 0)) })); }}
                      className="text-right font-extrabold outline-none bg-transparent"
                      style={{ color: editPrices ? C.orange : C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 21, width: 92, minWidth: 0 }} />
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2.5">
                <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 21 }}>{t.estTotal}</span>
                <span className="font-extrabold" style={{ color: C.orange, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 28 }}>{fmt(eTotal)}</span>
              </div>
            </div>
            <Btn onClick={toEstimate} disabled={roofCalc.squares < 1 || eTotal <= 0}>{t.toEstimate}</Btn>
          </div>
          </div>
        ) : (
          <>
            <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
              <Field label={t.footprint} value={fp} onChange={setFp} type="number" />
              <div className="grid grid-cols-2 gap-x-3">
                <Sel label={t.stories} value={stories} onChange={setStories} options={[["1", "1"], ["2", "2"], ["3", "3"]]} />
                <Sel label={t.pitch} value={pitch} onChange={setPitch} options={Object.keys(PITCH_FACTORS).map(p => [p, `${p}/12`])} />
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-bold" style={{ color: C.navy }}>{t.tearOff}</span>
                <button onClick={() => setTearOff(!tearOff)} className="rounded-full w-14 h-8 flex items-center px-1 transition-all"
                  style={{ background: tearOff ? C.orange : C.line, border: "none", justifyContent: tearOff ? "flex-end" : "flex-start" }}>
                  <span className="w-6 h-6 rounded-full bg-white" style={{ boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
                </button>
              </div>
              {tearOff && <Sel label={t.layers} value={layers} onChange={setLayers} options={[["1", "1"], ["2", "2"], ["3", "3"]]} />}
            </div>
            <p className="text-xs font-bold tracking-widest mb-1.5 px-1" style={{ color: C.slate }}>{t.materialType.toUpperCase()}</p>
            {materialPicker}
            {wasteChips}
            <div className="rounded-2xl p-4 mb-4" style={{ background: C.navy }}>
              <p className="text-xs font-bold tracking-widest mb-2" style={{ color: C.orange }}>{t.result}</p>
              {[[t.pitch + " factor", roofCalc.factor.toFixed(3)], [t.roofArea, Math.round(roofCalc.area) + " sq ft"], [t.squares, roofCalc.squares], [`${t.matSquares} +${roofWaste}%`, roofCalc.matSquares + " sq"]].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1">
                  <span className="text-sm font-semibold" style={{ color: "#9DA8C4" }}>{k}</span>
                  <span className="font-extrabold text-white" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{v}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {!lookup && (
          <div className="rounded-2xl p-4 mb-4" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
            <p className="text-xs font-bold tracking-widest mb-2" style={{ color: C.slate }}>{t.optPrice}</p>
            <div className="grid grid-cols-2 gap-x-3">
              <Field label={t.matPerSq} value={matSq} onChange={setMatSq} type="number" />
              <Field label={t.laborPerSq} value={labSq} onChange={setLabSq} type="number" />
            </div>
            {tearOff && <Field label={t.tearPerSq} value={tearSq} onChange={setTearSq} type="number" />}
            <div className="flex justify-between py-1"><span className="text-sm font-semibold" style={{ color: C.slate }}>{matName} ({roofCalc.matSquares} sq)</span><span className="font-bold" style={{ color: C.navy }}>{fmt(eMat)}</span></div>
            <div className="flex justify-between py-1"><span className="text-sm font-semibold" style={{ color: C.slate }}>{t.accessories}</span><span className="font-bold" style={{ color: C.navy }}>{fmt(eAcc)}</span></div>
            {tearOff && <div className="flex justify-between py-1"><span className="text-sm font-semibold" style={{ color: C.slate }}>{t.tearOffLine}</span><span className="font-bold" style={{ color: C.navy }}>{fmt(eTear)}</span></div>}
            <div className="flex justify-between py-1"><span className="text-sm font-semibold" style={{ color: C.slate }}>{t.labor}{parseInt(stories) > 1 ? " (" + t.storyNote + ")" : ""}</span><span className="font-bold" style={{ color: C.navy }}>{fmt(eLab)}</span></div>
            <div className="flex justify-between pt-2 mt-1" style={{ borderTop: `1.5px solid ${C.line}` }}>
              <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{t.estTotal}</span>
              <span className="font-extrabold" style={{ color: C.orange, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24 }}>{fmt(eTotal)}</span>
            </div>
          </div>
        )}
        {!lookup && <Btn onClick={toEstimate}>{t.toEstimate}</Btn>}
    </div>
  );
};

  const PickCustomer = () => {
    const withJobs = new Set(jobs.map(j => j.custId));
    const newOnes = customers.filter(c => !withJobs.has(c.id));
    const prevOnes = customers.filter(c => withJobs.has(c.id));
    const list = pickTab === "new" ? newOnes : prevOnes;
    return (
    <div className="app-scroll flex-1 overflow-y-auto px-5 pb-4">
      <p className="font-extrabold mb-4" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26 }}>{t.forWho}</p>
      <div className="flex gap-2 mb-4">
        {[["new", t.pickTabNew, newOnes.length], ["prev", t.pickTabPrev, prevOnes.length]].map(([id, lb, n]) => (
          <button key={id} onClick={() => setPickTab(id)} className="flex-1 rounded-xl py-2.5 font-bold text-sm"
            style={pickTab === id ? { background: C.navy, color: "#fff", border: "none" } : { background: "#fff", color: C.slate, border: `1.5px solid ${C.line}` }}>
            {lb}{n ? ` (${n})` : ""}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="text-center mt-2 mb-4 font-semibold text-sm" style={{ color: C.slate }}>{pickTab === "new" ? t.pickNoneNew : t.pickNonePrev}</p>}
      {list.map(c => (
        <div key={c.id} className="w-full rounded-2xl mb-3 flex items-center gap-2" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          <button onClick={() => createEstimate(c.id)} className="flex-1 min-w-0 p-4 flex items-center gap-3 active:scale-95 transition-transform text-left" style={{ background: "none", border: "none" }}>
            <span className="w-10 h-10 rounded-full flex items-center justify-center font-extrabold shrink-0" style={{ background: C.orangeSoft, color: C.orange }}>{c.name[0]}</span>
            <span className="min-w-0"><span className="block font-bold truncate" style={{ color: C.navy }}>{c.name}</span><span className="text-sm truncate block" style={{ color: C.slate }}>{c.phone || c.addr || ""}</span></span>
          </button>
          {pickTab === "new" && (
            <button onClick={() => { if (!window.confirm(`${t.removeCustQ} ${c.name} ${t.removeCustQ2}`)) return; setCustomers(customers.filter(x => x.id !== c.id)); showToast(t.custRemoved); }}
              className="w-9 h-9 mr-3 rounded-full flex items-center justify-center font-extrabold shrink-0" style={{ background: C.bg, color: C.slate, border: "none" }}>✕</button>
          )}
        </div>
      ))}
      {newCust === null ? (
        <button onClick={() => setNewCust({ name: "", phone: "" })} className="w-full rounded-2xl p-4 font-bold" style={{ background: "none", border: `2px dashed ${C.orange}`, color: C.orange }}>{t.addCustomer}</button>
      ) : (
        <div className="rounded-2xl p-4" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          <Field label={t.name} value={newCust.name} onChange={(v) => setNewCust({ ...newCust, name: v })} />
          <Field label={t.phone} value={newCust.phone} onChange={(v) => setNewCust({ ...newCust, phone: v })} type="tel" />
          <Btn onClick={() => {
            const c = { id: Date.now(), name: newCust.name || "—", phone: newCust.phone, addr: "" };
            setCustomers([...customers, c]); setNewCust(null); createEstimate(c.id);
          }}>{t.save}</Btn>
        </div>
      )}
    </div>
    );
  };

  const SendScreen = () => {
    if (!activeJob) return null;
    const c = custOf(activeJob);
    return (
      <div className={deskShell ? "app-scroll flex-1 overflow-y-auto px-5 pb-6" : "flex-1 px-5 flex flex-col"}>
        <div style={deskShell ? { display: "grid", gridTemplateColumns: "minmax(0,1fr) 400px", gap: 20, alignItems: "start" } : undefined}>
        {/* Desktop: the office sees EXACTLY what the client will receive,
            live, while they send it. */}
        {deskShell && (
          <div className="rounded-2xl overflow-hidden" style={{ border: `1.5px solid ${C.line}`, background: "#fff", height: "calc(100vh - 180px)", minHeight: 420 }}>
            {sendPrev
              ? <iframe title="estimate-preview" src={sendPrev}
                  style={{ width: "125%", height: "125%", border: 0, transform: "scale(0.8)", transformOrigin: "0 0" }} />
              : <div className="w-full h-full flex items-center justify-center text-sm font-bold" style={{ color: C.slate }}>📄 …</div>}
          </div>
        )}
        <div>
        <div className="rounded-2xl p-5 text-center mb-4" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          <Logo size={48} />
          <p className="font-extrabold mt-2" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24 }}>{t.estimate} #{activeJob.inv} {t.ready} ✓</p>
          <p className="font-semibold" style={{ color: C.slate }}>{c.name}</p>
          <p className="font-extrabold mt-1" style={{ color: C.orange, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 32 }}>{fmt(activeJob.amount)}</p>
          <p className="text-sm" style={{ color: C.slate }}>{activeJob.title[lang]}{trade === "concrete" ? " · " + t.finish : ""}</p>
        </div>
        <div className="grid gap-3">
          <Btn onClick={() => shareDoc(activeJob, "est")}>{t.sendText}</Btn>
          <Btn color="#fff" textColor={C.navy} style={{ border: `1.5px solid ${C.line}` }}
            onClick={async () => { window.location.href = buildShareUrl(activeJob, "est", await ensureLogoId()) + "&app=1"; }}>{t.viewPdf}</Btn>
          <Btn color={C.navy} onClick={() => {
            setJobs(jobs.map(j => j.id === activeJob.id ? { ...j, status: "accepted" } : j));
            setScreen("jobDetail");
            showToast(`${t.accepted} ✓`);
          }}>{t.simulateAccept}</Btn>
        </div>
        </div>
        </div>
      </div>
    );
  };

  const JobsList = () => (
    <div className="app-scroll flex-1 overflow-y-auto px-5 pb-4">
      {deskShell && (
        <div className="flex items-center gap-3 mt-1 mb-3">
          <input value={listQ} onChange={(e) => setListQ(e.target.value)} placeholder={t.searchList}
            className="flex-1 rounded-xl px-4 text-sm font-semibold" style={{ height: 38, border: `1.5px solid ${C.line}`, background: "#fff", color: C.navy, outline: "none" }} />
          {[["date", t.sortRecent], ["debt", t.sortDebt], ["amt", t.sortBig]].map(([v, lb]) => (
            <button key={v} onClick={() => setSortJ(v)} className="rounded-xl px-3 text-xs font-extrabold shrink-0"
              style={{ height: 38, background: sortJ === v ? C.navy : "#fff", color: sortJ === v ? "#fff" : C.slate, border: `1.5px solid ${sortJ === v ? C.navy : C.line}` }}>{lb}</button>
          ))}
          <button onClick={() => {
            if (trade === "roofing" || trade === "fence") { setAddrQ(""); setPlaceSugs(null); setLookup(null); setScreen("roofAddress"); }
            else { setLookup(null); setScreen("calc"); }
          }} className="dskrow rounded-xl px-4 text-sm font-extrabold shrink-0" style={{ height: 38, background: C.orange, color: C.navy, border: "none" }}>{t.newJob}</button>
        </div>
      )}
      <div className="rounded-2xl p-4 mt-1 mb-3 flex justify-around items-start text-center" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
        {[["📋", jobs.filter(j => j.status === "estimate").length, t.statEstimates], ["🔨", jobs.filter(j => j.status !== "paid" && j.status !== "estimate").length, t.statActive], ["💵", fmt(owed), t.statOwed]].map(([ic, v, lb], i) => (
          <div key={i} className="flex-1">
            <p className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24 }}>{v}</p>
            <p className="text-xs font-semibold mt-0.5" style={{ color: C.slate }}>{ic} {lb}</p>
          </div>
        ))}
      </div>
      {jobs.length === 0 && <p className="text-center mt-10 font-semibold" style={{ color: C.slate }}>{t.noJobs}</p>}
      {(() => {
        // Jobs live in month folders like the leads mini-CRM: newest month
        // open, older ones collapsed — the list stays usable after year one.
        const jobTs = (j) => j.date || (j.id > 1e12 ? j.id : Date.now());
        const q = deskShell ? listQ.trim().toLowerCase() : "";
        const srcJobs = q ? jobs.filter((j) => {
          const c2 = custOf(j);
          return String(c2.name || "").toLowerCase().includes(q) || String(j.title?.[lang] || "").toLowerCase().includes(q)
            || String(j.inv || "").toLowerCase().includes(q) || String(c2.phone || "").includes(q);
        }) : jobs;
        const deskRow = (j) => {
          const c = custOf(j);
          const bal = j.amount - j.paidAmt;
          return (
            <button key={j.id} onClick={() => { setActiveJobId(j.id); setScreen("jobDetail"); }}
              className="dskrow w-full text-left flex items-center gap-3 px-3 mt-2"
              style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 14, height: 58 }}>
              <div className="shrink-0 rounded-lg overflow-hidden relative" style={{ width: 38, height: 38, background: C.navy }}>
                <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: 17, opacity: 0.85 }}>🏠</div>
                {j.meas && j.meas.lat != null && (
                  <img src={`/api/streetview?lat=${j.meas.lat}&lng=${j.meas.lng}`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover" }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }} />
                )}
              </div>
              <span className="font-bold truncate shrink-0" style={{ color: C.navy, width: 185 }}>{c.name}</span>
              <span className="text-sm font-semibold truncate flex-1" style={{ color: C.slate }}>{j.title[lang]}</span>
              <StatusPill status={j.status} t={t} />
              <span className="text-xs font-bold shrink-0" style={{ color: daysOld(j) >= 7 ? C.red : C.yellow, width: 104, textAlign: "right" }}>
                {bal > 0 && j.status !== "estimate" ? `${fmt(bal)} · ${daysOld(j)}${t.daysShort}` : ""}
              </span>
              <span className="font-extrabold shrink-0" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19, width: 92, textAlign: "right" }}>{fmt(j.amount)}</span>
            </button>
          );
        };
        // "who do I chase / what's biggest" wants ONE flat sorted list, not
        // month folders — desktop-only, folders stay the default
        if (deskShell && sortJ !== "date") {
          const flat = [...srcJobs].sort(sortJ === "debt"
            ? (a, b) => (b.amount - b.paidAmt) - (a.amount - a.paidAmt)
            : (a, b) => (b.amount || 0) - (a.amount || 0));
          return <div className="mb-3">{flat.map(deskRow)}</div>;
        }
        const byMonth = new Map();
        [...srcJobs].sort((a, b) => jobTs(b) - jobTs(a)).forEach((j) => {
          const d = new Date(jobTs(j));
          const k = d.getFullYear() * 12 + d.getMonth();
          if (!byMonth.has(k)) byMonth.set(k, []);
          byMonth.get(k).push(j);
        });
        const keys = [...byMonth.keys()].sort((a, b) => b - a);
        const open = jobOpenMonths || (keys.length ? [keys[0]] : []);
        const toggle = (k) => setJobOpenMonths(open.includes(k) ? open.filter((x) => x !== k) : [...open, k]);
        const monthName = (k) => {
          const s = new Date(Math.floor(k / 12), k % 12, 1).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric" });
          return s.charAt(0).toUpperCase() + s.slice(1);
        };
        return keys.map((k) => {
          const list = byMonth.get(k);
          const mTotal = list.reduce((s, j) => s + (j.status !== "estimate" ? (j.amount || 0) : 0), 0);
          const isOpen = open.includes(k);
          return (
            <div key={k} className="mb-3">
              <button onClick={() => toggle(k)} className="w-full rounded-2xl px-4 py-3 flex items-center gap-2"
                style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
                <span className="text-base">{isOpen ? "📂" : "📁"}</span>
                <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19 }}>{monthName(k)}</span>
                <span className="text-xs font-bold" style={{ color: C.slate }}>· {list.length}</span>
                <span className="ml-auto font-extrabold text-sm" style={{ color: C.navy }}>{mTotal > 0 ? fmt(mTotal) : ""} <span style={{ color: C.slate }}>{isOpen ? "▾" : "▸"}</span></span>
              </button>
              {isOpen && <div>{list.map((j) => {
                const c = custOf(j);
                const bal = j.amount - j.paidAmt;
                if (deskShell) return deskRow(j);
                return (
                  <button key={j.id} onClick={() => { setActiveJobId(j.id); setScreen("jobDetail"); }}
                    className="w-full rounded-2xl p-3 mt-2 text-left active:scale-95 transition-transform flex gap-3 items-center" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
                    {/* Front-of-house thumbnail (Street View). Falls back to a clean house
                        badge when there's no measured location or no street coverage. */}
                    <div className="shrink-0 rounded-xl overflow-hidden relative" style={{ width: 60, height: 60, background: C.navy }}>
                      <div className="absolute inset-0 flex items-center justify-center" style={{ fontSize: 26, opacity: 0.85 }}>🏠</div>
                      {j.meas && j.meas.lat != null && (
                        <img src={`/api/streetview?lat=${j.meas.lat}&lng=${j.meas.lng}`} alt=""
                          className="absolute inset-0 w-full h-full" style={{ objectFit: "cover" }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="font-bold truncate" style={{ color: C.navy }}>{c.name}</span>
                        <StatusPill status={j.status} t={t} />
                      </div>
                      <p className="text-sm font-semibold truncate" style={{ color: C.slate }}>{j.title[lang]}</p>
                      <div className="flex justify-between mt-1">
                        <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{fmt(j.amount)}</span>
                        {bal > 0 && j.status !== "estimate" && <span className="text-sm font-bold" style={{ color: daysOld(j) >= 7 ? C.red : C.yellow }}>{fmt(bal)} · {daysOld(j)}{t.daysShort}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}</div>}
            </div>
          );
        });
      })()}
      {!deskShell && <Btn onClick={() => {
        if (trade === "roofing" || trade === "fence") { setAddrQ(""); setPlaceSugs(null); setLookup(null); setScreen("roofAddress"); }
        else { setLookup(null); setScreen("calc"); }
      }}>{t.newJob}</Btn>}
    </div>
  );

  const JobDetail = () => {
    if (!activeJob) return null;
    const c = custOf(activeJob);
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        <div style={deskShell ? { display: "grid", gridTemplateColumns: "minmax(0,1fr) 400px", gap: 20, alignItems: "start" } : undefined}>
        <div>
        <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="font-extrabold flex-1 min-w-0" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22 }}>{activeJob.title[lang]}</span>
            <StatusPill status={activeJob.status} t={t} />
            <button onClick={() => setEditJob({ lines: activeJob.lines.map((l) => [...l]), custId: activeJob.custId, title: activeJob.title[lang], addr: activeJob.addr || "" })}
              className="text-sm font-bold shrink-0" style={{ background: "none", border: "none", color: C.orange }}>✏️</button>
          </div>
          <p className="font-semibold" style={{ color: C.slate }}>{c.name} · {c.phone}</p>
          <p className="text-sm" style={{ color: C.slate }}>{t.jobAddr}: {activeJob.addr || c.addr || "—"}</p>
          {(activeJob.addr || c.addr || activeJob.meas?.lat != null) && (
            <button onClick={() => driveTo(activeJob.addr || c.addr, activeJob.meas?.lat, activeJob.meas?.lng)}
              className="w-full rounded-xl py-2.5 mt-3 text-sm font-bold active:scale-95"
              style={{ background: C.bg, color: C.navy, border: "none" }}>🗺️ {t.directions}</button>
          )}
        </div>
        {editJob && (
          <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `2px solid ${C.orange}` }}>
            <p className="text-xs font-bold tracking-widest mb-2" style={{ color: C.orange }}>{t.editJobT.toUpperCase()}</p>
            <Field label={t.concept} value={editJob.title} onChange={(v) => setEditJob({ ...editJob, title: v })} />
            <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: C.slate }}>{t.cust}</p>
            <select value={editJob.custId} onChange={(e) => setEditJob({ ...editJob, custId: Number(e.target.value) })}
              className="w-full rounded-xl px-3 py-3 mb-3 text-sm font-semibold outline-none" style={{ border: `1.5px solid ${C.line}`, color: C.navy, background: "#fff" }}>
              {customers.map((cu) => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
            </select>
            <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: C.slate }}>{t.lines || "Líneas"}</p>
            {editJob.lines.map(([lbl, amt], i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <input value={t[lbl] || lbl} onChange={(e) => { const ls = editJob.lines.map((x) => [...x]); ls[i][0] = e.target.value; setEditJob({ ...editJob, lines: ls }); }}
                  className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ border: `1.5px solid ${C.line}`, outline: "none", color: C.navy }} />
                <div className="flex items-center rounded-xl px-2" style={{ border: `1.5px solid ${C.line}` }}>
                  <span style={{ color: C.slate, fontWeight: 800 }}>$</span>
                  <input type="number" inputMode="numeric" value={amt} onChange={(e) => { const ls = editJob.lines.map((x) => [...x]); ls[i][1] = Math.round(parseFloat(e.target.value) || 0); setEditJob({ ...editJob, lines: ls }); }}
                    className="w-20 py-2.5 text-right font-bold outline-none bg-transparent" style={{ color: C.navy }} />
                </div>
                <button onClick={() => setEditJob({ ...editJob, lines: editJob.lines.filter((_, j) => j !== i) })} className="text-lg font-bold px-1" style={{ background: "none", border: "none", color: C.red }}>✕</button>
              </div>
            ))}
            <button onClick={() => setEditJob({ ...editJob, lines: [...editJob.lines, [lang === "es" ? "Concepto" : "Item", 0]] })}
              className="text-sm font-extrabold mb-3" style={{ background: "none", border: "none", color: C.orange, padding: 0 }}>+ {t.viAddLine.replace("➕ ", "")}</button>
            <div className="flex justify-between py-2" style={{ borderTop: `1px solid ${C.line}` }}>
              <span className="font-extrabold" style={{ color: C.navy }}>{t.estTotal}</span>
              <span className="font-extrabold" style={{ color: C.orange }}>{fmt(editJob.lines.reduce((s2, [, v]) => s2 + (Number(v) || 0), 0))}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Btn color="#fff" textColor={C.slate} style={{ border: `1.5px solid ${C.line}` }} onClick={() => setEditJob(null)}>{t.cancel || "✕"}</Btn>
              <Btn onClick={() => {
                const lines = editJob.lines.filter(([lb]) => String(lb).trim());
                const total = lines.reduce((s2, [, v]) => s2 + (Number(v) || 0), 0);
                const ttl = editJob.title.trim() || activeJob.title[lang];
                setJobs(jobs.map((j) => j.id === activeJob.id
                  ? { ...j, custId: editJob.custId, title: { es: ttl, en: ttl }, lines, amount: total }
                  : j));
                setEditJob(null);
                showToast(t.saved + " ✓");
              }}>✓ {t.save}</Btn>
            </div>
          </div>
        )}
        <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          <p className="text-xs font-bold tracking-widest mb-2" style={{ color: C.slate }}>{t.photos} ({(activeJob.pics || []).length})</p>
          <div className="flex gap-2 flex-wrap">
            {(activeJob.pics || []).map((src, i) => (
              <button key={i} onClick={() => setViewPic(src)} className="w-16 h-16 rounded-xl overflow-hidden p-0" style={{ border: `1.5px solid ${C.line}`, background: C.bg }}>
                <img src={src} alt="" className="w-full h-full" style={{ objectFit: "cover" }} />
              </button>
            ))}
            {(activeJob.pics || []).length < 6 && (
              <label className="w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold cursor-pointer"
                style={{ background: C.orangeSoft, color: C.orange, border: `2px dashed ${C.orange}` }}>
                📷
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={(e) => { addJobPhoto(activeJob.id, e.target.files?.[0]); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </div>
        </div>
        <div>
        {/* Move the job through its real life: estimate → accepted →
            scheduled → in progress → done/paid. Tap the current stage to set
            it; this was previously a dead end after the one-time Send screen. */}
        <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          <p className="text-xs font-bold tracking-widest mb-2" style={{ color: C.slate }}>{t.jobStatus.toUpperCase()}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {[["estimate", t.estimateSt], ["accepted", t.accepted], ["scheduled", t.scheduled], ["inprogress", t.inProgress], ["done", t.done], ["paid", t.paid]].map(([v, lb]) => {
              const on = activeJob.status === v;
              return (
                <button key={v} onClick={() => {
                  setJobs(jobs.map(j => j.id === activeJob.id
                    ? { ...j, status: v, ...(v === "paid" ? { paidAmt: j.amount } : {}) }
                    : j));
                  showToast(lb + " ✓");
                }} className="rounded-lg px-1 py-2 text-xs font-extrabold active:scale-95 transition-transform"
                  style={{ background: on ? C.navy : C.bg, color: on ? "#fff" : C.slate, border: "none" }}>{lb}</button>
              );
            })}
          </div>
        </div>
        {/* An unapproved estimate re-sends as an ESTIMATE; anything past that
            generates the invoice. Prevents sending "Factura" before approval. */}
        {activeJob.status === "estimate" ? (
          <Btn onClick={() => setScreen("send")}>{t.reSendEst}</Btn>
        ) : (
          <Btn onClick={() => setScreen("invoice")}>{activeJob.paidAmt > 0 || activeJob.status === "paid" ? t.invoice + ` #${activeJob.inv}` : t.genInvoice}</Btn>
        )}
        {activeJob.meas && (activeJob.meas.roofArea != null || (activeJob.meas.prod && activeJob.meas.netFt != null)) && (
          <div className="mt-3">
            <Btn color="#fff" textColor={C.navy} style={{ border: `1.5px solid ${C.line}` }}
              onClick={async () => {
                if (activeJob.meas.roofArea != null) openMeasReport(activeJob.meas, activeJob.addr || c.addr || "");
                else window.location.href = buildShareUrl(activeJob, "est", await ensureLogoId()) + "&app=1";
              }}>📄 {t.reportBtn}</Btn>
          </div>
        )}
        {/* Job finished → harvest the review while the client is happiest.
            Happy path ends on their Google review; unhappy stays private. */}
        {(activeJob.status === "done" || activeJob.status === "paid") && (
          <div className="mt-3">
            <Btn color="#F8B408" textColor={C.navy}
              onClick={() => {
                const link = `${window.location.origin}/opina/${slug || "alto-demo"}`;
                const msg = t.revMsg(bizName || "ALTO Pro") + " " + link;
                const ph = String(c?.phone || "").replace(/\D/g, "");
                window.open(`https://wa.me/${ph ? (ph.length === 10 ? "1" + ph : ph) : ""}?text=` + encodeURIComponent(msg), "_blank");
              }}>{t.askReview}</Btn>
          </div>
        )}
        <button onClick={() => {
          if (!window.confirm(t.delJobQ)) return;
          setJobs(jobs.filter(j => j.id !== activeJob.id));
          setScreen("jobs");
          showToast("🗑 ✓");
        }} className="w-full py-3 mt-4 text-sm font-bold" style={{ background: "none", border: "none", color: C.red }}>🗑 {t.delJob}</button>
        </div>
        </div>
      </div>
    );
  };

  const Invoice = () => {
    if (!activeJob) return null;
    const c = custOf(activeJob);
    // Real date for this job: an explicit date, else a timestamp-style id,
    // else derived from how many days ago it was created (seed/legacy jobs).
    const jobTs = activeJob.date
      || (activeJob.id > 1e12 ? activeJob.id : Date.now() - (activeJob.days || 0) * 86400000);
    const invDate = new Date(jobTs).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "short", year: "numeric" });
    const deposit = activeJob.paidAmt;
    const bal = activeJob.amount - deposit;
    const paid = activeJob.status === "paid";
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        <div className="rounded-2xl overflow-hidden mb-4" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ background: C.navy }}>
            <div>
              <p className="font-extrabold text-white" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{(bizName || "SOUTH TEXAS ROOFING").toUpperCase()}</p>
              <p className="text-xs font-semibold" style={{ color: "#9DA8C4" }}>{t.invoice} #{activeJob.inv} · {invDate}</p>
            </div>
            {logo
              ? <img src={logo} alt="" style={{ maxHeight: 40, maxWidth: 110, background: "#fff", borderRadius: 8, padding: 3 }} />
              : <Logo size={36} color="#fff" />}
          </div>
          <div className="px-5 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
            <p className="font-bold" style={{ color: C.navy }}>{c.name}</p>
            <p className="text-sm" style={{ color: C.slate }}>{activeJob.addr || c.addr || "—"}</p>
          </div>
          <div className="px-5 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
            {activeJob.lines.map(([k, v], i) => (
              <div key={i} className="flex justify-between py-1">
                <span className="text-sm font-semibold" style={{ color: C.slate }}>{k === "labor" ? t.labor : t[k] || k}</span>
                <span className="font-bold" style={{ color: C.navy }}>{fmt(v)}</span>
              </div>
            ))}
          </div>
          <div className="px-5 py-3">
            <div className="flex justify-between py-0.5"><span className="text-sm font-semibold" style={{ color: C.slate }}>{t.subtotal}</span><span className="font-bold" style={{ color: C.navy }}>{fmt(activeJob.amount)}</span></div>
            <div className="flex justify-between py-0.5"><span className="text-sm font-semibold" style={{ color: C.slate }}>{t.tax}</span><span className="font-bold" style={{ color: C.navy }}>$0</span></div>
            <div className="flex justify-between py-0.5"><span className="text-sm font-semibold" style={{ color: C.slate }}>{t.depositRec}</span><span className="font-bold" style={{ color: C.green }}>–{fmt(deposit)}</span></div>
            <div className="flex justify-between pt-2 mt-1" style={{ borderTop: `1.5px solid ${C.line}` }}>
              <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{t.balance}</span>
              <span className="font-extrabold" style={{ color: paid ? C.green : C.orange, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24 }}>{paid ? "✓ " + t.paid : fmt(bal)}</span>
            </div>
          </div>
        </div>
        <div className="rounded-2xl p-4 mb-4" style={{ background: C.orangeSoft }}>
          <p className="text-xs font-bold tracking-widest mb-1" style={{ color: C.orange }}>{t.howToPay}</p>
          {zelleNum && <p className="text-sm font-semibold" style={{ color: C.navy }}>🏦 Zelle: <b>{zelleNum}</b></p>}
          <p className="text-sm font-semibold" style={{ color: C.navy }}>💵 {t.payCash}</p>
        </div>
        {!paid && !payForm && (
          <div className="grid gap-3">
            <Btn onClick={() => shareDoc(activeJob, "inv")}>{t.sendText}</Btn>
            <Btn color="#fff" textColor={C.navy} style={{ border: `1.5px solid ${C.line}` }}
              onClick={async () => (window.location.href = buildShareUrl(activeJob, "inv", await ensureLogoId()) + "&app=1")}>{t.viewPdf}</Btn>
            <Btn color={C.navy} onClick={() => setPayForm({ amt: String(bal), m: "Zelle" })}>{t.regPay}</Btn>
          </div>
        )}
        {!paid && payForm && (
          <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `2px solid ${C.orange}` }}>
            <Field label={t.payAmt + " ($)"} value={payForm.amt} onChange={(v) => setPayForm({ ...payForm, amt: v })} type="number" />
            <p className="text-xs font-bold tracking-widest mb-1.5" style={{ color: C.slate }}>{t.payMethod.toUpperCase()}</p>
            <div className="flex gap-1.5 mb-3">
              {[["Zelle", t.mZelle], ["Efectivo", t.mCash], ["Cheque", t.mCheck]].map(([v, lb]) => (
                <button key={v} onClick={() => setPayForm({ ...payForm, m: v })} className="flex-1 rounded-xl px-1 py-2.5 text-sm font-extrabold active:scale-95 transition-transform"
                  style={{ background: payForm.m === v ? C.orange : C.bg, border: `1.5px solid ${payForm.m === v ? C.orange : C.line}`, color: payForm.m === v ? "#fff" : C.navy }}>{lb}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Btn color="#fff" textColor={C.slate} style={{ border: `1.5px solid ${C.line}` }} onClick={() => setPayForm(null)}>✕</Btn>
              <Btn onClick={() => {
                const amt = Math.round(parseFloat(payForm.amt) || 0);
                if (amt <= 0) return;
                const newPaid = Math.min(activeJob.amount, activeJob.paidAmt + amt);
                const rec = { a: amt, m: payForm.m, d: Date.now() };
                setJobs(jobs.map(j => j.id === activeJob.id
                  ? { ...j, paidAmt: newPaid, lastPay: rec, status: newPaid >= j.amount ? "paid" : (j.status === "estimate" ? "accepted" : j.status), days: newPaid >= j.amount ? 0 : j.days }
                  : j));
                setPayForm(null);
                showToast(t.payReg + " ✓");
              }}>✓ {t.save}</Btn>
            </div>
          </div>
        )}
        {(activeJob.lastPay || activeJob.paidAmt > 0) && (
          <div className="mt-3">
            <Btn color="#1E9E5A" onClick={() => shareDoc(activeJob, "rec")}>{t.sendReceipt}</Btn>
          </div>
        )}
      </div>
    );
  };

  const Payments = () => {
    const unpaid = jobs.filter(j => j.status !== "paid" && j.status !== "estimate" && j.amount - j.paidAmt > 0).sort((a, b) => daysOld(b) - daysOld(a));
    // Per-month business numbers, the way an owner thinks:
    //   VENDIDO — jobs closed that month (accepted/done/paid, by job date)
    //   COBRADO — money actually received that month (by payment date)
    const months = new Map(); // key = year*12+month → {sold, got, n}
    const bump = (ts, field, amt) => {
      const d = new Date(ts);
      const k = d.getFullYear() * 12 + d.getMonth();
      const m = months.get(k) || { sold: 0, got: 0, n: 0 };
      m[field] += amt;
      if (field === "sold") m.n += 1;
      months.set(k, m);
    };
    jobs.forEach((j) => {
      const ts = j.date || (j.id > 1e12 ? j.id : Date.now());
      if (j.status !== "estimate") bump(ts, "sold", j.amount || 0);
      if (j.paidAmt) bump(j.lastPay?.d || ts, "got", j.paidAmt);
    });
    const now = new Date();
    const nowK = now.getFullYear() * 12 + now.getMonth();
    const cur = months.get(nowK) || { sold: 0, got: 0, n: 0 };
    const history = [...months.entries()].filter(([k]) => k !== nowK).sort((a, b) => b[0] - a[0]).slice(0, 6);
    const monthName = (k) => {
      const s = new Date(Math.floor(k / 12), k % 12, 1).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric" });
      return s.charAt(0).toUpperCase() + s.slice(1);
    };
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-4">
        <div className="rounded-2xl p-4 mb-3" style={{ background: C.navy }}>
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-bold tracking-widest" style={{ color: C.orange }}>📅 {monthName(nowK).toUpperCase()}</p>
            <p className="text-xs font-bold" style={{ color: "#9DA8C4" }}>{cur.n} {t.jobs.toLowerCase()}</p>
          </div>
          <div className="flex gap-3 mt-2">
            <div className="flex-1">
              <p className="text-xs font-bold tracking-widest" style={{ color: "#9DA8C4" }}>{t.soldLbl.toUpperCase()}</p>
              <p className="font-extrabold text-white" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 32 }}>{fmt(cur.sold)}</p>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold tracking-widest" style={{ color: "#9DA8C4" }}>{t.collectedLbl.toUpperCase()}</p>
              <p className="font-extrabold" style={{ color: "#7BE3A8", fontFamily: "'Barlow Condensed',sans-serif", fontSize: 32 }}>{fmt(cur.got)}</p>
            </div>
          </div>
          <p className="text-xs font-bold tracking-widest mt-1" style={{ color: "#9DA8C4" }}>{t.theyOwe.toUpperCase()}: <span style={{ color: "#fff" }}>{fmt(owed)}</span></p>
        </div>
        {history.length > 0 && (
          <div className="rounded-2xl px-4 py-2 mb-4" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
            <div className="flex justify-between py-1.5" style={{ borderBottom: `1.5px solid ${C.line}` }}>
              <span></span>
              <span className="text-xs font-bold tracking-widest" style={{ color: C.slate }}>{t.soldLbl.toUpperCase()} · <span style={{ color: C.green }}>{t.collectedLbl.toUpperCase()}</span></span>
            </div>
            {history.map(([k, m]) => (
              <div key={k} className="flex justify-between py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
                <span className="text-sm font-semibold" style={{ color: C.slate }}>{monthName(k)}</span>
                <span className="font-extrabold text-sm" style={{ color: C.navy }}>{fmt(m.sold)} · <span style={{ color: C.green }}>{fmt(m.got)}</span></span>
              </div>
            ))}
          </div>
        )}
        {(() => {
          // Owed-by-month folders, same idea as Trabajos: newest month open,
          // older ones collapsed — so a long history doesn't just sit there.
          const mKey = (x) => { const d = new Date(x.date || (x.id > 1e12 ? x.id : Date.now())); return d.getFullYear() * 12 + d.getMonth(); };
          const monthName = (k) => {
            const s = new Date(Math.floor(k / 12), k % 12, 1).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric" });
            return s.charAt(0).toUpperCase() + s.slice(1);
          };
          const byMonth = new Map();
          unpaid.forEach((j) => { const k = mKey(j); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(j); });
          const keys = [...byMonth.keys()].sort((a, b) => b - a);
          const openM = payOpenMonths || (keys.length ? [keys[0]] : []);
          const toggle = (k) => setPayOpenMonths(openM.includes(k) ? openM.filter((x) => x !== k) : [...openM, k]);
          return keys.map((k) => {
            const list = byMonth.get(k);
            const mOwed = list.reduce((s, j) => s + (j.amount - j.paidAmt), 0);
            const isOpen = openM.includes(k);
            return (
              <div key={k} className="mb-3">
                <button onClick={() => toggle(k)} className="w-full rounded-2xl px-4 py-3 flex items-center gap-2"
                  style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
                  <span className="text-base">{isOpen ? "📂" : "📁"}</span>
                  <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19 }}>{monthName(k)}</span>
                  <span className="text-xs font-bold" style={{ color: C.slate }}>· {list.length}</span>
                  <span className="ml-auto font-extrabold text-sm" style={{ color: C.red }}>{fmt(mOwed)} <span style={{ color: C.slate }}>{isOpen ? "▾" : "▸"}</span></span>
                </button>
                {isOpen && list.map((j) => {
                  const c = custOf(j);
                  const late = daysOld(j) >= 7;
                  return (
                    <div key={j.id} className="rounded-2xl p-4 mt-2 flex items-center gap-3" style={{ background: "#fff", border: `1.5px solid ${late ? C.red : C.line}` }}>
                      <span className="text-xl">{late ? "🔴" : "⏳"}</span>
                      <button className="flex-1 text-left" style={{ background: "none", border: "none", padding: 0 }} onClick={() => { setActiveJobId(j.id); setScreen("invoice"); }}>
                        <span className="block font-bold" style={{ color: C.navy }}>{c.name}</span>
                        <span className="text-sm font-semibold" style={{ color: late ? C.red : C.slate }}>{fmt(j.amount - j.paidAmt)} · {daysOld(j)}{t.daysShort} {late ? "· " + t.overdue : ""}</span>
                      </button>
                      <button onClick={() => {
                        const bal = fmt(j.amount - j.paidAmt);
                        const body = lang === "es"
                          ? `Hola ${c.name}, un recordatorio amable de su saldo de ${bal} con ${bizName || "ALTO Pro"}. ¡Gracias!`
                          : `Hi ${c.name}, a friendly reminder of your ${bal} balance with ${bizName || "ALTO Pro"}. Thank you!`;
                        textCust(c, body);
                      }} className="rounded-xl px-4 py-2 font-bold text-sm" style={{ background: C.orangeSoft, color: C.orange, border: "none" }}>{t.remind}</button>
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
        {unpaid.length === 0 && <p className="text-center mt-8 font-semibold" style={{ color: C.green }}>✓ {t.paid} 🎉</p>}
      </div>
    );
  };

  const Customers = () => (
    <div className="app-scroll flex-1 overflow-y-auto px-5 pb-4">
      {deskShell && (
        <div className="flex items-center gap-3 mt-1 mb-3">
          <input value={listQ} onChange={(e) => setListQ(e.target.value)} placeholder={t.searchList}
            className="flex-1 rounded-xl px-4 text-sm font-semibold" style={{ height: 38, border: `1.5px solid ${C.line}`, background: "#fff", color: C.navy, outline: "none" }} />
          {[["az", t.sortAZ], ["debt", t.sortDebt]].map(([v, lb]) => (
            <button key={v} onClick={() => setSortC(v)} className="rounded-xl px-3 text-xs font-extrabold shrink-0"
              style={{ height: 38, background: sortC === v ? C.navy : "#fff", color: sortC === v ? "#fff" : C.slate, border: `1.5px solid ${sortC === v ? C.navy : C.line}` }}>{lb}</button>
          ))}
          <span className="text-xs font-bold shrink-0" style={{ color: C.slate }}>{customers.length} {t.customers.toLowerCase()}</span>
        </div>
      )}
      <div>
      {(() => {
        let ls = deskShell && listQ.trim()
          ? customers.filter((c2) => String(c2.name || "").toLowerCase().includes(listQ.trim().toLowerCase()) || String(c2.phone || "").includes(listQ.trim()))
          : customers;
        if (deskShell) {
          const owesOf = (c2) => {
            const cj = jobs.filter((j) => j.custId === c2.id);
            const sold = cj.filter((j) => j.status !== "estimate").reduce((s, j) => s + (j.amount || 0), 0);
            const paid = cj.reduce((s, j) => s + (j.paidAmt || 0), 0);
            return Math.max(0, sold - paid);
          };
          ls = [...ls].sort(sortC === "debt" ? (a, b) => owesOf(b) - owesOf(a) : (a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        }
        return ls;
      })().map(c => {
        // Tap a customer → their full history: every quote and invoice, what
        // they've paid, and what they still owe. Rows open the job itself.
        const cJobs = jobs.filter(j => j.custId === c.id).sort((a, b) => (b.date || b.id) - (a.date || a.id));
        const isOpen = custOpen === c.id;
        const sold = cJobs.filter(j => j.status !== "estimate").reduce((s, j) => s + (j.amount || 0), 0);
        const paid = cJobs.reduce((s, j) => s + (j.paidAmt || 0), 0);
        const owes = Math.max(0, sold - paid);
        const when = (j) => {
          const d = new Date(j.date || (j.id > 1e12 ? j.id : Date.now()));
          return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "short", year: "2-digit" });
        };
        return (
          <div key={c.id} className={deskShell ? "dskrow rounded-2xl px-4 py-3 mb-2" : "rounded-2xl p-4 mb-3"} style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
            <div className="flex items-center gap-2">
              <button onClick={() => setCustOpen(isOpen ? null : c.id)} className="flex-1 min-w-0 flex items-center gap-3 text-left" style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                <span className="rounded-full flex items-center justify-center font-extrabold shrink-0" style={{ width: deskShell ? 34 : 40, height: deskShell ? 34 : 40, background: C.orangeSoft, color: C.orange }}>{c.name[0]}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate" style={{ color: C.navy }}>{c.name}</p>
                  <p className="text-sm" style={{ color: C.slate }}>{c.phone}{cJobs.length ? ` · ${cJobs.length} ${t.jobs.toLowerCase()}` : ""}</p>
                </div>
              </button>
              {deskShell && owes > 0 && <span className="text-xs font-extrabold shrink-0" style={{ color: C.red }}>{t.custOwes} {fmt(owes)}</span>}
              {deskShell && (
                <span className="flex items-center gap-1 shrink-0">
                  <button title={t.call} onClick={() => callCust(c)} className="snv rounded-lg" style={{ width: 32, height: 32, background: C.bg, border: "none", cursor: "pointer" }}>📞</button>
                  <button title={t.text} onClick={() => textCust(c)} className="snv rounded-lg" style={{ width: 32, height: 32, background: C.bg, border: "none", cursor: "pointer" }}>💬</button>
                  {(() => {
                    const a2 = c.addr || cJobs.find((j) => j.addr)?.addr;
                    const jm2 = cJobs.find((j) => j.meas?.lat != null)?.meas;
                    return (a2 || jm2) ? <button title={t.directions} onClick={() => driveTo(a2, jm2?.lat, jm2?.lng)} className="snv rounded-lg" style={{ width: 32, height: 32, background: C.bg, border: "none", cursor: "pointer" }}>🗺️</button> : null;
                  })()}
                </span>
              )}
              <button onClick={() => setCustOpen(isOpen ? null : c.id)} className="font-extrabold shrink-0" style={{ background: "none", border: "none", color: C.slate, cursor: "pointer", padding: "0 2px" }}>{isOpen ? "▾" : "▸"}</button>
            </div>
            {!deskShell && <div className="flex gap-2 mt-3">
              <button onClick={() => callCust(c)} className="flex-1 rounded-xl px-3 py-2 text-sm font-bold" style={{ background: C.bg, color: C.navy, border: "none" }}>{t.call}</button>
              <button onClick={() => textCust(c)} className="flex-1 rounded-xl px-3 py-2 text-sm font-bold" style={{ background: C.bg, color: C.navy, border: "none" }}>{t.text}</button>
            </div>}
            {/* the contact trio: call, text… and drive there. Address from the
                customer record or their most recent job with one. */}
            {!deskShell && (() => {
              const a = c.addr || cJobs.find((j) => j.addr)?.addr;
              const jm = cJobs.find((j) => j.meas?.lat != null)?.meas;
              return (a || jm) ? (
                <button onClick={() => driveTo(a, jm?.lat, jm?.lng)} className="w-full rounded-xl px-3 py-2 mt-2 text-sm font-bold active:scale-95"
                  style={{ background: C.bg, color: C.navy, border: "none" }}>🗺️ {t.directions}</button>
              ) : null;
            })()}
            {isOpen && (
              <div className="mt-3 pt-1" style={{ borderTop: `1.5px solid ${C.line}` }}>
                {cJobs.length === 0 && <p className="text-sm font-semibold mt-2" style={{ color: C.slate }}>{t.custNoJobs}</p>}
                {cJobs.map(j => (
                  <button key={j.id} onClick={() => { setActiveJobId(j.id); setScreen("jobDetail"); }}
                    className="w-full flex items-center gap-2 py-2.5 text-left" style={{ background: "none", border: "none", borderBottom: `1px solid ${C.line}`, padding: "10px 0" }}>
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-bold truncate" style={{ color: C.navy }}>#{j.inv} · {j.title[lang]}</span>
                      <span className="text-xs font-semibold" style={{ color: C.slate }}>{when(j)}</span>
                    </div>
                    <StatusPill status={j.status} t={t} />
                    <span className="font-extrabold text-sm" style={{ color: C.navy, minWidth: 62, textAlign: "right" }}>{fmt(j.amount)}</span>
                  </button>
                ))}
                {cJobs.length > 0 && (
                  <div className="flex justify-around pt-3 text-center">
                    {[[t.custSold, fmt(sold), C.navy], [t.custPaid, fmt(paid), C.green], [t.custOwes, fmt(owes), owes > 0 ? C.red : C.slate]].map(([lb, v, col], i) => (
                      <div key={i}>
                        <p className="text-xs font-bold tracking-widest" style={{ color: C.slate }}>{lb.toUpperCase()}</p>
                        <p className="font-extrabold" style={{ color: col, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{v}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );

  /* FENCE ACCURATE #3 — property confirmation. The contractor sees the found
   * boundary (or every nearby candidate in neutral gray) over the aerial photo
   * and confirms the lot BEFORE any measuring. Demo users get the curated
   * example picker instead of a live parcel. */
  const FenceConfirm = () => {
    if (!fConfirm) return null;
    const fc = fConfirm;

    // ── demo variant: curated examples, no map ──
    if (fc.state === "demo") {
      return (
        <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
          <div className="rounded-2xl p-5 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
            <p className="font-extrabold mb-1" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22 }}>{t.exTitle}</p>
            <p className="text-xs mb-4" style={{ color: C.slate }}>{t.exSub}</p>
            {fc.examples.map((ex) => (
              <button key={ex.slot} onClick={() => { setFConfirm(null); openFence({ lat: ex.lat, lng: ex.lng, addr: ex.addr, parcel: ex.parcel, raw: ex.parcel, parcelId: `example-${ex.slot}`, example: ex.name }); }}
                className="w-full rounded-xl px-4 py-3 mb-2 text-left active:scale-95"
                style={{ background: C.orangeSoft, border: `1.5px solid ${C.orange}` }}>
                <span className="block text-sm font-extrabold" style={{ color: C.navy }}>🛰️ {ex.name}</span>
                <span className="block text-xs font-semibold truncate" style={{ color: C.slate }}>{ex.addr}</span>
              </button>
            ))}
          </div>
          <Btn color="#fff" textColor={C.navy} style={{ border: `1.5px solid ${C.line}` }}
            onClick={() => { setFConfirm(null); openFence({ lat: fc.lat, lng: fc.lng, addr: fc.addr, zoom: 19, parcel: null }); }}>
            ✏️ {t.exDraw}
          </Btn>
          <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "#9AA3B2" }}>{t.parcelDemoDraw}</p>
        </div>
      );
    }

    // ── found / ambiguous: candidates over the aerial photo ──
    const rings = fc.cands.map((c) => c.disp || c.raw);
    let s = 90, w = 180, nn = -90, e = -180;
    rings.forEach((r) => r.forEach(([la, ln]) => { s = Math.min(s, la); nn = Math.max(nn, la); w = Math.min(w, ln); e = Math.max(e, ln); }));
    const ctrLat = (s + nn) / 2, ctrLng = (w + e) / 2;
    const span = Math.max(nn - s, (e - w) * Math.cos(ctrLat * Math.PI / 180), 0.0001) * 1.7;
    const zoom = Math.min(Math.max(Math.floor(Math.log2((360 * (640 / 256)) / span)), 15), 20);
    const view = { lat: ctrLat, lng: ctrLng, zoom };
    const sel = fc.cands[fc.sel] || fc.cands[0];

    const pickAt = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * TRACE_W, y = ((e.clientY - rect.top) / rect.height) * TRACE_H;
      const [la, ln] = pxToLl(x, y, view);
      // the candidate whose ring contains the tap wins; else nearest centroid
      let best = -1;
      fc.cands.forEach((c, i) => { if (best < 0 && pointInRingApp(la, ln, c.disp || c.raw)) best = i; });
      if (best < 0) {
        let bd = Infinity;
        fc.cands.forEach((c, i) => {
          const r = c.disp || c.raw;
          const cy = r.reduce((a, p) => a + p[0], 0) / r.length, cx = r.reduce((a, p) => a + p[1], 0) / r.length;
          const d = Math.hypot(la - cy, ln - cx);
          if (d < bd) { bd = d; best = i; }
        });
      }
      if (best >= 0 && best !== fc.sel) setFConfirm({ ...fc, sel: best });
    };

    const go = () => {
      const c = fc.cands[fc.sel] || fc.cands[0];
      openFence({ lat: fc.lat, lng: fc.lng, addr: c.addr || fc.addr, parcel: c.disp || c.raw, raw: c.raw || c.disp, parcelId: c.id || null, fromConfirm: true });
    };

    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        <p className="text-xs font-bold mb-2" style={{ color: C.navy }}>
          {fc.state === "ambiguous" || fc.cands.length > 1 ? "👆 " + t.confirmPick : "📍 " + (fc.addr || "")}
        </p>
        <div className="relative rounded-2xl overflow-hidden mb-3" style={{ aspectRatio: "1280/800", background: C.navyDeep }} onPointerUp={pickAt}>
          <img src={`/api/roofimg?lat=${view.lat}&lng=${view.lng}&zoom=${view.zoom}`} alt=""
            className="absolute inset-0 w-full h-full" draggable={false} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <svg viewBox={`0 0 ${TRACE_W} ${TRACE_H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
            {fc.cands.map((c, i) => {
              const px = (c.disp || c.raw).map((p) => llToPx(p, view));
              const on = i === fc.sel;
              return (
                <polygon key={i} points={px.map((p) => `${p[0]},${p[1]}`).join(" ")}
                  fill={on ? "rgba(248,180,8,.16)" : "rgba(255,255,255,.05)"}
                  stroke={on ? C.orange : "rgba(255,255,255,.75)"} strokeWidth={on ? 6 : 3} />
              );
            })}
          </svg>
        </div>
        <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          <p className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 21 }}>{t.confirmTitle}</p>
          {sel?.addr && <p className="text-xs font-semibold mt-1" style={{ color: C.slate }}>📍 {sel.addr}</p>}
          {fc.cands.length > 1 && <p className="text-xs mt-1" style={{ color: C.slate }}>{fc.sel + 1} / {fc.cands.length}</p>}
        </div>
        <Btn onClick={go}>✓ {t.confirmYes}</Btn>
        <div className="flex gap-2 mt-2">
          {fc.cands.length > 1 && (
            <button onClick={() => setFConfirm({ ...fc, sel: (fc.sel + 1) % fc.cands.length })}
              className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy }}>{t.confirmOther}</button>
          )}
          <button onClick={() => { setFConfirm(null); openFence({ lat: fc.lat, lng: fc.lng, addr: fc.addr, zoom: 19, parcel: null }); }}
            className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.slate }}>✏️ {t.confirmDraw}</button>
        </div>
        <button onClick={() => pickSurvey({ lat: fc.lat, lng: fc.lng, addr: fc.addr })} disabled={surveyBusy}
          className="w-full rounded-xl py-3 text-sm font-bold mt-2 active:scale-95"
          style={{ background: C.navy, color: "#fff", opacity: surveyBusy ? 0.6 : 1 }}>
          {surveyBusy ? t.surveyReading : `📄 ${t.importSurvey}`}
        </button>
        <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: "#9AA3B2" }}>{t.surveyHint}</p>
        <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "#9AA3B2" }}>{t.parcelDisclaimer}</p>
        {surveyInput}
      </div>
    );
  };

  const FenceDraw = () => {
    if (!fenceBase) return null;
    const FH = fenceBase.H || TRACE_H; // square fence map (1280) vs legacy 800
    // MEASUREMENT geometry is the RAW ring (7 decimals, never simplified) —
    // the display ring exists only for other surfaces. Selection starts EMPTY.
    const P = fenceBase.raw || fenceBase.parcel, n = P ? P.length : 0;
    // ring position p ∈ [0,n): integer part = vertex index, fraction = how far
    // along the edge to the next vertex. Lets a route endpoint sit ANYWHERE on
    // the boundary (drag-to-adjust), not only on cadastral corners. Integer
    // positions are exactly the old vertex-index routes — fully compatible.
    const ringPos = (p) => {
      const i = ((Math.floor(p) % n) + n) % n, f = p - Math.floor(p);
      if (!f) return P[i];
      const A = P[i], B = P[(i + 1) % n];
      return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f];
    };
    // route → concrete points along the ring (a/b may be fractional)
    const routePts = (r) => {
      if (r.full) return { pts: P, closed: true };
      const span = r.dir === 1 ? (r.b - r.a + n) % n : (r.a - r.b + n) % n;
      const out = [ringPos(r.a)];
      for (let s = r.dir === 1 ? Math.floor(r.a) + 1 : Math.ceil(r.a) - 1;
        r.dir === 1 ? s < r.a + span : s > r.a - span; s += r.dir) {
        out.push(P[((s % n) + n) % n]);
        if (out.length > n + 1) break;
      }
      const end = ringPos(((r.dir === 1 ? r.a + span : r.a - span) % n + n) % n);
      const last = out[out.length - 1];
      if (Math.abs(end[0] - last[0]) > 1e-9 || Math.abs(end[1] - last[1]) > 1e-9) out.push(end);
      return { pts: out, closed: false };
    };
    // cursor px → closest ring position (endpoint drag slides along the lot line)
    const nearestRingPos = (x, y, maxD = 120) => {
      let best = null, bestD = maxD;
      for (let i = 0; i < n; i++) {
        const A = llToPx(P[i], fenceBase), B = llToPx(P[(i + 1) % n], fenceBase);
        const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1;
        const tt = Math.max(0, Math.min(1, ((x - A[0]) * dx + (y - A[1]) * dy) / L2));
        const d = Math.hypot(x - (A[0] + tt * dx), y - (A[1] + tt * dy));
        if (d < bestD) { bestD = d; best = i + Math.min(tt, 0.9999); }
      }
      return best;
    };
    const routeFt = (r) => { const { pts, closed } = routePts(r); return closed ? runFt([...pts, pts[0]]) : runFt(pts); };
    const selRuns = P ? fSel.map(routePts) : [];
    // run order MUST match fGates' runIdx: [selected routes…, finished runs…]
    const finishedRuns = fRuns.map((pts) => ({ pts }));
    const committedRuns = [...selRuns, ...finishedRuns]; // gate-addressable
    const allRuns = [...committedRuns, ...(fCur.length >= 2 ? [{ pts: fCur }] : [])];
    const lf$ = parseFloat(fLF) || 0;
    // unified history: EVERY map action snapshots first, so Deshacer reverses
    // parcel selections, manual points, finished runs, gates — any of it.
    const pushHist = () => setFHist((h) => [...h.slice(-39), { sel: fSel, runs: fRuns, cur: fCur, start: fStart, gates: fGates, parcel: fenceBase.parcel, raw: fenceBase.raw }]);
    // gate = free green line {a, b}: its LENGTH is the width (custom, drawn)
    const DEG_LAT_PER_FT = 1 / ((Math.PI / 180) * 6378137 * 3.28084);
    const gateW = (g) => distFt(g.a, g.b);
    const gateKind = (g) => (gateW(g) <= 6 ? "walk" : "double");
    // which fence line does this gate open? DERIVED by geometry (midpoint
    // within 2.5 ft of a run) — no stored indexes to go stale when runs change
    const gateRun = (g) => {
      const m = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
      const cz = Math.cos(m[0] * Math.PI / 180), F = 1 / DEG_LAT_PER_FT;
      let best = -1, bestD = 2.5;
      committedRuns.forEach((run2, ri2) => {
        const q = run2.closed ? [...run2.pts, run2.pts[0]] : run2.pts;
        for (let i2 = 1; i2 < q.length; i2++) {
          const ax = (q[i2 - 1][1] - m[1]) * cz * F, ay = (q[i2 - 1][0] - m[0]) * F;
          const bx2 = (q[i2][1] - m[1]) * cz * F, by2 = (q[i2][0] - m[0]) * F;
          const ddx = bx2 - ax, ddy = by2 - ay, L2 = ddx * ddx + ddy * ddy || 1;
          const tt = Math.max(0, Math.min(1, (-ax * ddx - ay * ddy) / L2));
          const d2 = Math.hypot(ax + tt * ddx, ay + tt * ddy);
          if (d2 < bestD) { bestD = d2; best = ri2; }
        }
      });
      return best;
    };
    // ONE shared engine (src/fenceMath.js) does all construction math: net
    // footage = gross − gate openings, panels per run, REAL corners (direction
    // changes, not raw vertices), gate posts, prices. Same engine the estimate
    // and measurement sheet consume — numbers can never diverge.
    const q = fenceQuote({
      runs: allRuns,
      // width IS the drawn line (custom, never assumed); kind by width; only
      // gates sitting ON the fence (attached) subtract their opening
      gates: [
        ...fGates.map((g) => ({ kind: gateKind(g), widthFt: gateW(g), price: g.price, runIdx: gateRun(g) })),
      ],
      product: { lfPrice: lf$, panelW: parseFloat(fPanelW) > 0 ? parseFloat(fPanelW) : 8 },
      markupPct: parseFloat(fMk) || 0,
    });
    const totalLF = q.netFt;
    const { panels, corners, total } = q;
    const posts = q.postsTotal;
    const fenceCost = q.fenceCost, gatesCost = q.gatesCost, mkAmt = q.markupAmt;
    const typeLabel = { cedar: t.cedar, vinyl: t.vinyl, chain: t.chain, alum: t.alum, ranch: t.ranch, custom: t.custom };

    // pixel position of a gate = point at tFrac along its committed run
    // A gate is a FREE GREEN LINE (same pattern as Agregar cerca): tap the
    // button, an 8 ft line pops out mid-screen, stretch the dots to the REAL
    // width (never assumed) and slide it where it goes. Dropped on the fence
    // it snaps flat and its feet subtract from the fence; away from it, it's
    // a free gate (priced, no subtraction).
    const spawnGate = () => {
      pushHist();
      const c = pxToLl(TRACE_W / 2, FH / 2, fenceBase);
      const half = 4 * DEG_LAT_PER_FT / Math.cos(c[0] * Math.PI / 180); // 4 ft in °lng
      setFGates([...fGates, { a: [c[0], c[1] - half], b: [c[0], c[1] + half], price: null }]);
    };
    // on release near a fence line: align the gate ALONG it (length kept) and
    // remember which run it opens — that run loses the gate's feet
    const snapGate = (gi, cs5) => {
      const g = fGates[gi];
      if (!g) return;
      // FREE placement is the rule (front gates often have no fence line at
      // all) — snapping only when the drop practically touches a line
      const mid = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
      const [mx, my] = llToPx(mid, fenceBase);
      let best = null, bestD = 8 * cs5;
      committedRuns.forEach((run2, ri2) => {
        const q = run2.closed ? [...run2.pts, run2.pts[0]] : run2.pts;
        let acc = 0; const totalFt = runFt(q);
        for (let i2 = 1; i2 < q.length; i2++) {
          const A = llToPx(q[i2 - 1], fenceBase), B = llToPx(q[i2], fenceBase);
          const ddx = B[0] - A[0], ddy = B[1] - A[1], L2 = ddx * ddx + ddy * ddy || 1;
          const tt = Math.max(0, Math.min(1, ((mx - A[0]) * ddx + (my - A[1]) * ddy) / L2));
          const d2 = Math.hypot(mx - (A[0] + tt * ddx), my - (A[1] + tt * ddy));
          const segFt3 = distFt(q[i2 - 1], q[i2]);
          if (d2 < bestD) {
            bestD = d2;
            best = { runIdx: ri2, tFrac: totalFt ? (acc + tt * segFt3) / totalFt : 0, p1: q[i2 - 1], p2: q[i2], tt };
          }
          acc += segFt3;
        }
      });
      if (!best) return; // dropped in open space: stays a free gate
      // center on the fence line, aligned with it, same custom width
      const ctr = [best.p1[0] + (best.p2[0] - best.p1[0]) * best.tt, best.p1[1] + (best.p2[1] - best.p1[1]) * best.tt];
      const cz = Math.cos(ctr[0] * Math.PI / 180);
      const vFt = [(best.p2[1] - best.p1[1]) * cz / DEG_LAT_PER_FT, (best.p2[0] - best.p1[0]) / DEG_LAT_PER_FT];
      const vm = Math.hypot(...vFt) || 1;
      const u = [vFt[0] / vm, vFt[1] / vm], h = gateW(g) / 2;
      setFGates(fGates.map((g2, i) => (i === gi ? {
        ...g2,
        a: [ctr[0] - u[1] * h * DEG_LAT_PER_FT, ctr[1] - (u[0] * h * DEG_LAT_PER_FT) / cz],
        b: [ctr[0] + u[1] * h * DEG_LAT_PER_FT, ctr[1] + (u[0] * h * DEG_LAT_PER_FT) / cz],
      } : g2)));
    };
    const GATE_PRESETS = [
      { kind: "walk", widthFt: 4, label: t.gWalk4, price: parseFloat(fWalkP) || 0 },
      { kind: "double", widthFt: 10, label: t.gDbl10, price: parseFloat(fDblP) || 0 },
      { kind: "double", widthFt: 12, label: t.gDbl12, price: parseFloat(fDblP) || 0 },
      { kind: "double", widthFt: 16, label: t.gDbl16, price: parseFloat(fDblP) || 0 },
    ];

    const onDown = (e) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      // Grabbing a handle beats panning: route endpoints slide along the lot
      // line, hand-drawn points move freely. History snapshots on FIRST move
      // (a plain tap on a handle changes nothing and burns no undo step).
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * TRACE_W, y = ((e.clientY - rect.top) / rect.height) * FH;
      // Hit zones are FINGER-sized (CSS px × scale), not map-pixel-sized —
      // otherwise a bigger map shrinks every touch target and the line-grab
      // steals the gesture from the dot the thumb was aiming at.
      const cs2 = TRACE_W / rect.width;
      let drag = null;
      // 🧭 Ajustar lote: while unlocked, the ONE gesture is "move everything
      // together" — the lot (raw + display) and every fence element ride the
      // finger as a unit, so the alignment between them never changes.
      if (fAdjust && P) {
        drag = { kind: "lot", origRaw: fenceBase.raw, origDisp: fenceBase.parcel, origRuns: fRuns, origCur: fCur, origGates: fGates };
        tracePtr.current = { x: e.clientX, y: e.clientY, moved: false, drag };
        return;
      }
      // gates are grabbable in EVERY mode — a gate line is the most visible
      // thing on the map, dragging it must simply work
      fGates.forEach((g, gi2) => {
        const pa = llToPx(g.a, fenceBase), pb = llToPx(g.b, fenceBase);
        // a real gate is SHORT on screen — the endpoint zones overlap the
        // whole line. Closest target wins: middle = move, ends = stretch.
        const da = Math.hypot(pa[0] - x, pa[1] - y), db2 = Math.hypot(pb[0] - x, pb[1] - y);
        const dm = Math.hypot((pa[0] + pb[0]) / 2 - x, (pa[1] + pb[1]) / 2 - y);
        const reach = 26 * cs2;
        if (Math.min(da, db2, dm) >= reach) return;
        if (dm <= da && dm <= db2) drag = { kind: "gate", gi: gi2, orig: [g.a, g.b] };
        else if (da <= db2) drag = { kind: "gend", gi: gi2, which: "a" };
        else drag = { kind: "gend", gi: gi2, which: "b" };
      });
      if (!drag && fMode !== "gate") {
        if (P) fSel.forEach((r, ri) => {
          if (r.full) return;
          for (const which of ["a", "b"]) {
            const [hx, hy] = llToPx(ringPos(r[which]), fenceBase);
            if (Math.hypot(hx - x, hy - y) < 30 * cs2) drag = { kind: "end", ri, which };
          }
        });
        if (!drag) [...fRuns.map((pts, i) => ({ pts, set: "runs", i })), { pts: fCur, set: "cur", i: -1 }].forEach((run) => {
          run.pts.forEach((p, pi) => {
            const [hx, hy] = llToPx(p, fenceBase);
            if (Math.hypot(hx - x, hy - y) < 26 * cs2) drag = { kind: "pt", set: run.set, i: run.i, pi };
          });
        });
        // …or the LINE body: moves the whole run to where the fence really
        // sits. A boundary route detaches into a free line on first movement.
        if (!drag) {
          const lineHit = (pts, closed) => {
            const q = closed ? [...pts, pts[0]] : pts;
            for (let i = 1; i < q.length; i++) {
              const A = llToPx(q[i - 1], fenceBase), B = llToPx(q[i], fenceBase);
              const ddx = B[0] - A[0], ddy = B[1] - A[1], L2 = ddx * ddx + ddy * ddy || 1;
              const tt = Math.max(0, Math.min(1, ((x - A[0]) * ddx + (y - A[1]) * ddy) / L2));
              if (Math.hypot(x - (A[0] + tt * ddx), y - (A[1] + tt * ddy)) < 13 * cs2) return true;
            }
            return false;
          };
          if (P) fSel.forEach((r, ri) => { if (!drag) { const rp = routePts(r); if (lineHit(rp.pts, rp.closed)) drag = { kind: "line", set: "route", ri }; } });
          fRuns.forEach((pts, i) => { if (!drag && lineHit(pts)) drag = { kind: "line", set: "runs", i, orig: pts }; });
          if (!drag && fCur.length >= 2 && lineHit(fCur)) drag = { kind: "line", set: "cur", orig: fCur };
        }
        // draw mode, empty map: press-and-DRAG draws the fence like a pencil
        // (anchor at the press point or the last post; live feet on the way)
        if (!drag && fMode === "draw") drag = { kind: "draw" };
      }
      if (fLineSel) setFLineSel(null); // touching the map dismisses the chip
      // remember the line before this stroke so a 2nd finger (pan) can undo any
      // provisional pencil segment without wiping the posts already placed
      tracePtr.current = { x: e.clientX, y: e.clientY, moved: false, drag, fCurBefore: fCur };
    };
    const onMove = (e) => {
      if (!tracePtr.current) return;
      const dx = e.clientX - tracePtr.current.x, dy = e.clientY - tracePtr.current.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) tracePtr.current.moved = true;
      const drag = tracePtr.current.drag;
      if (drag) {
        if (!tracePtr.current.moved) return;
        if (!tracePtr.current.pushed) { pushHist(); tracePtr.current.pushed = true; }
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * TRACE_W, y = ((e.clientY - rect.top) / rect.height) * FH;
        // Offset pointer: the point lands ~70 CSS px ABOVE the finger so it is
        // never hidden under it; a crosshair marks the exact landing spot.
        // A mouse hides nothing — the point lands exactly at the cursor.
        const py = y - ((e.pointerType === "mouse" ? 0 : 70) / rect.height) * FH;
        if (drag.kind === "end") {
          const pos = nearestRingPos(x, py, 1e9); // always track the boundary
          if (pos != null) {
            const nr = { ...fSel[drag.ri], [drag.which]: pos };
            setFSel(fSel.map((r, ri) => (ri === drag.ri ? nr : r)));
            const cp = llToPx(ringPos(pos), fenceBase);
            setFPtr({ fx: x, fy: y, x: cp[0], y: cp[1], ft: Math.round(routeFt(nr)) });
          }
        } else if (drag.kind === "lot") {
          // translate the WORLD: parcel (raw + display) + runs + pencil line +
          // gates by the pointer's total delta — one rigid move, no reshaping
          const dxN = ((e.clientX - tracePtr.current.x) / rect.width) * TRACE_W;
          const dyN = ((e.clientY - tracePtr.current.y) / rect.height) * FH;
          const [la0, ln0] = pxToLl(TRACE_W / 2, FH / 2, fenceBase);
          const [la1, ln1] = pxToLl(TRACE_W / 2 + dxN, FH / 2 + dyN, fenceBase);
          const sh = (pts) => pts.map(([a, b]) => [a + (la1 - la0), b + (ln1 - ln0)]);
          const shp = ([a, b]) => [a + (la1 - la0), b + (ln1 - ln0)];
          setFenceBase({ ...fenceBase,
            parcel: drag.origDisp ? sh(drag.origDisp) : fenceBase.parcel,
            raw: drag.origRaw ? sh(drag.origRaw) : fenceBase.raw });
          setFRuns(drag.origRuns.map(sh));
          if (drag.origCur.length) setFCur(sh(drag.origCur));
          if (drag.origGates.length) setFGates(drag.origGates.map((g) => ({ ...g, a: shp(g.a), b: shp(g.b) })));
        } else if (drag.kind === "gate") {
          // move the whole gate with the finger (fence snap happens on release)
          const dxN = ((e.clientX - tracePtr.current.x) / rect.width) * TRACE_W;
          const dyN = ((e.clientY - tracePtr.current.y) / rect.height) * FH;
          const [la0, ln0] = pxToLl(TRACE_W / 2, FH / 2, fenceBase);
          const [la1, ln1] = pxToLl(TRACE_W / 2 + dxN, FH / 2 + dyN, fenceBase);
          setFGates(fGates.map((g, gi2) => (gi2 === drag.gi ? {
            ...g,
            a: [drag.orig[0][0] + (la1 - la0), drag.orig[0][1] + (ln1 - ln0)],
            b: [drag.orig[1][0] + (la1 - la0), drag.orig[1][1] + (ln1 - ln0)],
          } : g)));
        } else if (drag.kind === "gend") {
          // stretch a gate dot: the line's length IS the width — live feet
          const pt2 = pxToLl(x, py, fenceBase);
          const ng = { ...fGates[drag.gi], [drag.which]: pt2 };
          setFGates(fGates.map((g, gi2) => (gi2 === drag.gi ? ng : g)));
          const cp3 = llToPx(pt2, fenceBase);
          setFPtr({ fx: x, fy: y, x: cp3[0], y: cp3[1], ft: Math.round(gateW(ng)) });
        } else if (drag.kind === "draw") {
          // the line grows out of the finger; end point rides the crosshair
          let pt = pxToLl(x, py, fenceBase);
          if (P) for (let i = 0; i < n; i++) { const [vx, vy] = llToPx(P[i], fenceBase); if (Math.hypot(vx - x, vy - py) < 14 * (TRACE_W / rect.width)) { pt = P[i]; break; } }
          let cur2;
          if (!drag.started) {
            drag.started = true;
            if (fCur.length) cur2 = [...fCur, pt]; // chain from the last post
            else {
              let a0 = pxToLl(((tracePtr.current.x - rect.left) / rect.width) * TRACE_W, ((tracePtr.current.y - rect.top) / rect.height) * FH, fenceBase);
              if (P) { const ax = ((tracePtr.current.x - rect.left) / rect.width) * TRACE_W, ay = ((tracePtr.current.y - rect.top) / rect.height) * FH; for (let i = 0; i < n; i++) { const [vx, vy] = llToPx(P[i], fenceBase); if (Math.hypot(vx - ax, vy - ay) < 14 * (TRACE_W / rect.width)) { a0 = P[i]; break; } } }
              cur2 = [a0, pt];
            }
          } else {
            cur2 = fCur.map((p, pi) => (pi === fCur.length - 1 ? pt : p));
          }
          setFCur(cur2);
          const cp2 = llToPx(pt, fenceBase);
          setFPtr({ fx: x, fy: y, x: cp2[0], y: cp2[1], ft: Math.round(runFt(cur2)) });
        } else if (drag.kind === "line") {
          // translate the whole run by the pointer's total delta
          const dxN = ((e.clientX - tracePtr.current.x) / rect.width) * TRACE_W;
          const dyN = ((e.clientY - tracePtr.current.y) / rect.height) * FH;
          const [la0, ln0] = pxToLl(TRACE_W / 2, FH / 2, fenceBase);
          const [la1, ln1] = pxToLl(TRACE_W / 2 + dxN, FH / 2 + dyN, fenceBase);
          const shift = (pts) => pts.map(([a, b]) => [a + (la1 - la0), b + (ln1 - ln0)]);
          if (drag.set === "route") {
            // detach: boundary route → free line (gates keep riding it)
            const src = fSel[drag.ri];
            if (src) {
              const rp = routePts(src);
              const pts = rp.closed ? [...rp.pts, rp.pts[0]] : rp.pts;
              const S = fSel.length, F = fRuns.length;
              setFGates(fGates.map((g) => (g.runIdx === drag.ri ? { ...g, runIdx: S - 1 + F } : g.runIdx > drag.ri ? { ...g, runIdx: g.runIdx - 1 } : g)));
              setFSel(fSel.filter((_, ri) => ri !== drag.ri));
              setFRuns([...fRuns, shift(pts)]);
              Object.assign(drag, { set: "runs", i: F, orig: pts });
            }
          } else if (drag.set === "cur") setFCur(shift(drag.orig));
          else setFRuns(fRuns.map((pts, i) => (i === drag.i ? shift(drag.orig) : pts)));
        } else {
          let pt = pxToLl(x, py, fenceBase);
          if (P) for (let i = 0; i < n; i++) { const [vx, vy] = llToPx(P[i], fenceBase); if (Math.hypot(vx - x, vy - py) < 10 * (TRACE_W / rect.width)) { pt = P[i]; break; } }
          let newPts;
          if (drag.set === "cur") { newPts = fCur.map((p, pi) => (pi === drag.pi ? pt : p)); setFCur(newPts); }
          else {
            const src = fRuns[drag.i];
            const cl2 = src.length > 3 && src[0][0] === src[src.length - 1][0] && src[0][1] === src[src.length - 1][1];
            newPts = src.map((p, pi) => (pi === drag.pi ? pt : p));
            // closed loop: first & last are the SAME corner — move both
            if (cl2 && (drag.pi === 0 || drag.pi === src.length - 1)) { newPts[0] = pt; newPts[newPts.length - 1] = pt; }
            setFRuns(fRuns.map((pts, i) => (i === drag.i ? newPts : pts)));
          }
          const cp = llToPx(pt, fenceBase);
          setFPtr({ fx: x, fy: y, x: cp[0], y: cp[1], ft: Math.round(runFt(newPts)) });
        }
        return; // dragging a handle never pans the map
      }
      if (tracePtr.current.moved) setDragOff([dx, dy]);
    };
    const onUp = (e) => {
      const start = tracePtr.current;
      tracePtr.current = null;
      setFPtr(null);
      if (!start) return;
      // a finished drag ends here; a STILL tap on a FREE line selects it (🗑
      // chip); a still tap on a boundary route falls through to the side
      // toggle. Handle taps are swallowed — they must not re-arm the start pin.
      // 🧭 gesture done → LOCK again (one adjustment, then back to safety);
      // a still tap in adjust mode changes nothing and keeps it unlocked
      if (start.drag && start.drag.kind === "lot") {
        if (start.moved) { setFAdjust(false); showToast("🧭 " + t.adjustDone + " ✓"); }
        return;
      }
      if (start.drag && !start.moved && start.drag.kind === "gate") { setFGateEdit(start.drag.gi); return; } // tap a gate = edit it
      // released a moved gate (or its dot): settle it — near a fence line it
      // snaps flat onto it; in open space it stays free
      if (start.drag && start.moved && (start.drag.kind === "gate" || start.drag.kind === "gend")) {
        const r3 = e.currentTarget.getBoundingClientRect();
        snapGate(start.drag.gi, TRACE_W / r3.width);
        return;
      }
      // a still TAP in draw mode falls through (drops a single post as before)
      if (start.drag && (start.moved || (start.drag.kind !== "line" && start.drag.kind !== "draw"))) return;
      if (start.drag && start.drag.kind === "line" && start.drag.set !== "route") {
        // Still tap on an orange line. Multi-segment run → remove JUST the
        // tapped SIDE (closed loop opens; open run splits). Single segment →
        // the 🗑 chip (a lone line disappearing on a graze feels like a bug).
        const pts0 = start.drag.set === "cur" ? fCur : fRuns[start.drag.i];
        if (start.drag.set !== "cur" && pts0 && pts0.length > 2) {
          const rect2 = e.currentTarget.getBoundingClientRect();
          const tx = ((e.clientX - rect2.left) / rect2.width) * TRACE_W, ty = ((e.clientY - rect2.top) / rect2.height) * FH;
          let bj = 0, bd2 = Infinity;
          for (let j = 1; j < pts0.length; j++) {
            const A = llToPx(pts0[j - 1], fenceBase), B = llToPx(pts0[j], fenceBase);
            const ddx = B[0] - A[0], ddy = B[1] - A[1], L2 = ddx * ddx + ddy * ddy || 1;
            const tt = Math.max(0, Math.min(1, ((tx - A[0]) * ddx + (ty - A[1]) * ddy) / L2));
            const d2 = Math.hypot(tx - (A[0] + tt * ddx), ty - (A[1] + tt * ddy));
            if (d2 < bd2) { bd2 = d2; bj = j - 1; }
          }
          pushHist();
          const cl3 = pts0[0][0] === pts0[pts0.length - 1][0] && pts0[0][1] === pts0[pts0.length - 1][1];
          let pieces;
          if (cl3) {
            // closed → open: rotate so the removed side becomes the gap
            const base2 = pts0.slice(0, -1), n2 = base2.length;
            pieces = [[...Array(n2).keys()].map((k4) => base2[(bj + 1 + k4) % n2])];
          } else {
            pieces = [pts0.slice(0, bj + 1), pts0.slice(bj + 1)].filter((p2) => p2.length >= 2);
          }
          const gi = fSel.length + start.drag.i;
          setFGates(fGates.filter((g) => g.runIdx !== gi).map((g) => (g.runIdx > gi ? { ...g, runIdx: g.runIdx + pieces.length - 1 } : g)));
          setFRuns([...fRuns.slice(0, start.drag.i), ...pieces, ...fRuns.slice(start.drag.i + 1)]);
          setFLineSel(null);
          return;
        }
        setFLineSel({ set: start.drag.set, i: start.drag.i });
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      if (start.moved) {
        const dxN = ((e.clientX - start.x) / rect.width) * TRACE_W, dyN = ((e.clientY - start.y) / rect.height) * FH;
        const [lat, lng] = pxToLl(TRACE_W / 2 - dxN, FH / 2 - dyN, fenceBase);
        setDragOff([0, 0]);
        setFenceBase({ ...fenceBase, lat, lng });
      } else {
        const x = ((e.clientX - rect.left) / rect.width) * TRACE_W, y = ((e.clientY - rect.top) / rect.height) * FH;
        const cs3 = TRACE_W / rect.width; // finger-sized tap zones (CSS px × scale)
        // GATE mode: gates are created with ➕ Agregar puerta and placed by
        // dragging — a bare tap on the map does nothing here.
        if (fMode === "gate") return;
        // "Patio trasero": one trustworthy interaction — the contractor taps
        // the STREET side, we select everything else (rear + sides). Logical
        // sides come from real-corner grouping, so a curved frontage is one
        // side, and no AI guessing is involved.
        if (fFront && P) {
          const dseg = (p, a, b) => {
            const dx = b[0] - a[0], dy = b[1] - a[1];
            if (!dx && !dy) return Math.hypot(p[0] - a[0], p[1] - a[1]);
            const tt = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
            return Math.hypot(p[0] - (a[0] + tt * dx), p[1] - (a[1] + tt * dy));
          };
          let bestE = -1, bestD = 24 * cs3;
          for (let i = 0; i < n; i++) {
            const d = dseg([x, y], llToPx(P[i], fenceBase), llToPx(P[(i + 1) % n], fenceBase));
            if (d < bestD) { bestD = d; bestE = i; }
          }
          if (bestE < 0) return;
          let cs = cornerIndexes(P, 45);
          if (cs.length < 2) cs = [...Array(n).keys()]; // degenerate ring: every edge is a side
          // the logical side [cs[k], cs[k+1]] that owns edge bestE (edge i runs vertex i → i+1)
          let k = -1;
          for (let i = 0; i < cs.length; i++) {
            const a = cs[i], b = cs[(i + 1) % cs.length];
            const inSpan = a <= b ? bestE >= a && bestE < b : bestE >= a || bestE < b;
            if (inSpan) { k = i; break; }
          }
          if (k < 0) k = 0;
          pushHist();
          // the COMPLEMENT along the boundary: everything except the street
          // side, hugging every real bend of the lot line
          setFSel([]);
          setFRuns([ringPath(cs[(k + 1) % cs.length], cs[k])]);
          setFFront(false); setFStart(null);
          showToast("🏠 " + t.backyardDone);
          return;
        }
        // One tap = ONE meaning, decided by the explicit mode (never guessed).
        if (fMode === "sides" && P) {
          // snap to the nearest RAW vertex within reach
          let best = -1, bestD = 24 * cs3;
          for (let i = 0; i < n; i++) {
            const [px, py] = llToPx(P[i], fenceBase);
            const d = Math.hypot(px - x, py - y);
            if (d < bestD) { bestD = d; best = i; }
          }
          if (best < 0) {
            // not near a corner → tap ON a side toggles it: remove it from the
            // selection (split the route there) or add it back. This is the
            // main phone gesture — perimeter starts selected, taps subtract.
            const dseg2 = (p, a2, b2) => {
              const ddx = b2[0] - a2[0], ddy = b2[1] - a2[1];
              if (!ddx && !ddy) return Math.hypot(p[0] - a2[0], p[1] - a2[1]);
              const tt = Math.max(0, Math.min(1, ((p[0] - a2[0]) * ddx + (p[1] - a2[1]) * ddy) / (ddx * ddx + ddy * ddy)));
              return Math.hypot(p[0] - (a2[0] + tt * ddx), p[1] - (a2[1] + tt * ddy));
            };
            let bestE = -1, bd = 24 * cs3;
            for (let i = 0; i < n; i++) {
              const d2 = dseg2([x, y], llToPx(P[i], fenceBase), llToPx(P[(i + 1) % n], fenceBase));
              if (d2 < bd) { bd = d2; bestE = i; }
            }
            if (bestE < 0) return;
            let cs = cornerIndexes(P, 45); // big logical sides, not every bend
            if (cs.length < 2) cs = [...Array(n).keys()];
            let k = 0;
            for (let i = 0; i < cs.length; i++) {
              const a2 = cs[i], b2 = cs[(i + 1) % cs.length];
              if (a2 <= b2 ? bestE >= a2 && bestE < b2 : bestE >= a2 || bestE < b2) { k = i; break; }
            }
            const s = cs[k], e2 = cs[(k + 1) % cs.length];
            const mid2 = (s + ((e2 - s + n) % n) / 2) % n;
            const covers = (r) => {
              if (r.full) return true;
              const A = r.dir === 1 ? r.a : r.b, Bp = r.dir === 1 ? r.b : r.a;
              return ((mid2 - A + n) % n) < (Bp - A + n) % n;
            };
            const ri = fSel.findIndex(covers);
            pushHist();
            if (ri >= 0) {
              const r = fSel[ri];
              let pieces = [];
              if (r.full) pieces = [{ a: e2, b: s, dir: 1 }];
              else {
                const A = r.dir === 1 ? r.a : r.b, Bp = r.dir === 1 ? r.b : r.a;
                const L = (Bp - A + n) % n, os = (s - A + n) % n, oe = (e2 - A + n) % n;
                if (os > 0.01 && os <= L) pieces.push({ a: A, b: s, dir: 1 });
                if (oe < L - 0.01 && ((Bp - e2 + n) % n) > 0.01) pieces.push({ a: e2, b: Bp, dir: 1 });
              }
              setFSel([...fSel.slice(0, ri), ...pieces, ...fSel.slice(ri + 1)]);
            } else {
              // bare red side → orange side back, following the boundary
              setFRuns([...fRuns, ringPath(s, e2)]);
            }
            setFStart(null);
            return;
          }
          if (fStart == null) { pushHist(); setFStart(best); return; }
          if (best === fStart) { pushHist(); setFStart(null); return; } // tap again = cancel
          // two taps = one route; the SHORTER way around is the default,
          // "Usar el otro lado" flips it.
          const fwd = routeFt({ a: fStart, b: best, dir: 1 });
          const back = routeFt({ a: fStart, b: best, dir: -1 });
          pushHist();
          setFSel([...fSel.filter((r) => !r.full), { a: fStart, b: best, dir: fwd <= back ? 1 : -1 }]);
          setFStart(null);
          return;
        }
        // draw mode: manual points; endpoints snap to nearby parcel vertices
        let pt = pxToLl(x, y, fenceBase);
        if (P) {
          for (let i = 0; i < n; i++) {
            const [px, py] = llToPx(P[i], fenceBase);
            if (Math.hypot(px - x, py - y) < 14 * cs3) { pt = P[i]; break; }
          }
        }
        pushHist();
        setFCur([...fCur, pt]);
      }
    };
    const zoomBy = (d) => {
      const z = Math.min(Math.max(fenceBase.zoom + d, 15), 21);
      if (z !== fenceBase.zoom) setFenceBase({ ...fenceBase, zoom: z });
    };
    // Deshacer reverses the LAST map action of any kind (selection, manual
    // point, finished run) by restoring the snapshot taken before it.
    const undo = () => {
      if (!fHist.length) return;
      const s = fHist[fHist.length - 1];
      setFHist(fHist.slice(0, -1));
      setFSel(s.sel); setFRuns(s.runs); setFCur(s.cur); setFStart(s.start); setFGates(s.gates || []);
      // an 🧭 lot adjustment is just another undoable step
      if (s.parcel !== undefined) setFenceBase({ ...fenceBase, parcel: s.parcel, raw: s.raw });
      setFGateEdit(null); setFLineSel(null);
    };
    // Borrar wipes every proposed-fence element (routes, manual runs, gates)
    // and resets footage to zero — the neutral parcel stays. It's undoable.
    const clearAll = () => {
      pushHist();
      setFSel([]); setFRuns([]); setFCur([]); setFStart(null);
      setFGates([]); setFGateEdit(null); setFLineSel(null);
    };
    // Delete ONE tapped line (its gates go with it; later gates shift down)
    const deleteLine = () => {
      if (!fLineSel) return;
      pushHist();
      if (fLineSel.set === "cur") setFCur([]);
      else {
        const gi = fSel.length + fLineSel.i;
        setFGates(fGates.filter((g) => g.runIdx !== gi).map((g) => (g.runIdx > gi ? { ...g, runIdx: g.runIdx - 1 } : g)));
        setFRuns(fRuns.filter((_, i) => i !== fLineSel.i));
      }
      setFLineSel(null);
    };
    // width edits SCALE the line about its middle (the line is the width)
    const editGate = (patch) => {
      if (fGateEdit == null) return;
      pushHist();
      setFGates(fGates.map((g, i) => {
        if (i !== fGateEdit) return g;
        const ng = { ...g };
        if (patch.price !== undefined) ng.price = patch.price;
        if (patch.widthFt) {
          const mid = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
          const s = patch.widthFt / (gateW(g) || 1);
          ng.a = [mid[0] + (g.a[0] - mid[0]) * s, mid[1] + (g.a[1] - mid[1]) * s];
          ng.b = [mid[0] + (g.b[0] - mid[0]) * s, mid[1] + (g.b[1] - mid[1]) * s];
        }
        return ng;
      }));
    };
    const deleteGate = () => { if (fGateEdit == null) return; pushHist(); setFGates(fGates.filter((_, i) => i !== fGateEdit)); setFGateEdit(null); };
    const endRun = () => { if (fCur.length >= 2) { pushHist(); setFRuns([...fRuns, fCur]); setFCur([]); } };
    // signed turn (deg) at ring vertex i — local-feet plane so angles are true
    const turnAtV = (i) => {
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
      const k = Math.PI / 180, cz = Math.cos(b[0] * k);
      const v1 = [(b[1] - a[1]) * cz, b[0] - a[0]], v2 = [(c[1] - b[1]) * cz, c[0] - b[0]];
      const m1 = Math.hypot(...v1), m2 = Math.hypot(...v2);
      if (!m1 || !m2) return 0;
      const dot = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)));
      return (Math.acos(dot) * 180) / Math.PI;
    };
    // boundary path a→b (ring indexes, forward): every REAL bend kept (≥5°),
    // survey noise dropped — the fence HUGS the red line, never cuts corners
    const ringPath = (a, b) => {
      const out = [P[a]];
      for (let i = (a + 1) % n; i !== b; i = (i + 1) % n) if (turnAtV(i) >= 5) out.push(P[i]);
      out.push(P[b]);
      return out;
    };
    // the opening state: closed polygon following the whole boundary
    const cornerPoly = () => {
      const keep = [...Array(n).keys()].filter((i) => turnAtV(i) >= 5);
      const vs = keep.length >= 3 ? keep : [...Array(n).keys()];
      const cp = vs.map((i) => P[i]);
      return [...cp, cp[0]];
    };
    const selectFull = () => { if (!P) return; pushHist(); setFSel([]); setFGates([]); setFRuns([cornerPoly()]); setFStart(null); };
    const flipLast = () => {
      const i = fSel.map((r, ix) => (r.full ? -1 : ix)).filter((ix) => ix >= 0).pop();
      if (i == null) return;
      pushHist();
      setFSel(fSel.map((r, ix) => (ix === i ? { ...r, dir: -r.dir } : r)));
    };
    const proj = (pts) => pts.map(p => llToPx(p, fenceBase));
    // Two-finger pan/pinch + wheel-zoom around the single-finger fence handlers.
    // On 2nd finger: revert any provisional pencil segment, drop the drag.
    const fMap = makeMapHandlers({ down: onDown, move: onMove, up: onUp }, fenceBase, setFenceBase, TRACE_W, FH,
      () => { const s = tracePtr.current; if (s && s.fCurBefore && s.drag && s.drag.kind === "draw") setFCur(s.fCurBefore); tracePtr.current = null; setFPtr(null); setDragOff([0, 0]); });
    const fWrap = mapXform
      ? { transform: `translate(${mapXform.tx}px, ${mapXform.ty}px) scale(${mapXform.scale})`, transformOrigin: `${mapXform.ox}px ${mapXform.oy}px` }
      : { transform: `translate(${dragOff[0]}px, ${dragOff[1]}px)` };
    const labels = (pts) => {
      const px = proj(pts), out = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const ft = distFt(pts[i], pts[i + 1]);
        const [pa, pb] = [px[i], px[i + 1]];
        const sl = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        if (ft < 3 || sl < 55) continue;
        const nx = -(pb[1] - pa[1]) / sl, ny = (pb[0] - pa[0]) / sl;
        out.push({ x: (pa[0] + pb[0]) / 2 + nx * 40, y: (pa[1] + pb[1]) / 2 + ny * 40 + 14, ft: Math.round(ft) });
      }
      return out;
    };
    // One label per logical SIDE, like a paper sketch: front 101′, side 191′…
    // Splits at real direction changes (≥25°); a surveyed curve stays ONE side.
    const sideLabels = (pts) => {
      if (pts.length < 2) return [];
      const px = proj(pts);
      const groups = [];
      let gStart = 0;
      for (let i = 1; i + 1 < pts.length; i++) {
        const [a, b, c] = [px[i - 1], px[i], px[i + 1]];
        let d = (Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * 180 / Math.PI;
        d = ((d + 540) % 360) - 180;
        // 45°: chamfers and street curves merge into ONE side with ONE label —
        // real cadastral rings bend every few feet and labeling each piece
        // (14', 26', 47'…) buries the contractor. Footage math stays exact.
        if (Math.abs(d) >= 45) { groups.push([gStart, i]); gStart = i; }
      }
      groups.push([gStart, pts.length - 1]);
      const out = [];
      for (const [s, e2] of groups) {
        let ft = 0;
        for (let i = s; i < e2; i++) ft += distFt(pts[i], pts[i + 1]);
        const chord = Math.hypot(px[e2][0] - px[s][0], px[e2][1] - px[s][1]);
        if (ft < 3 || chord < 50) continue;
        // anchor the label at the side's halfway point (by length)
        let half = ft / 2, i = s;
        while (i < e2 - 1 && half > distFt(pts[i], pts[i + 1])) { half -= distFt(pts[i], pts[i + 1]); i++; }
        const A = px[i], B = px[i + 1];
        const segL = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
        const f = Math.max(0, Math.min(1, half / (distFt(pts[i], pts[i + 1]) || 1)));
        const mx = A[0] + (B[0] - A[0]) * f, my = A[1] + (B[1] - A[1]) * f;
        out.push({ x: mx + (-(B[1] - A[1]) / segL) * 44, y: my + ((B[0] - A[0]) / segL) * 44 + 14, ft: Math.round(ft) });
      }
      return out;
    };
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        {/* Desktop: two panels — the map works BIG on the left while the
            whole quote (totals, products, price, estimate button) sits in a
            right rail, so a rep sees everything without scrolling. On the
            phone these wrappers are plain divs and nothing changes. */}
        <div style={isDesk ? { display: "grid", gridTemplateColumns: "minmax(0,1fr) 380px", gap: 20, alignItems: "start" } : undefined}>
        <div>
        {/* No mode tabs: ONE working surface. Everything spawns from the
            bottom buttons; the pencil is a toggle chip down there too. */}
        <p className="text-xs font-bold mb-2" style={{ color: fAdjust ? "#B45309" : C.navy }}>
          {fAdjust ? t.adjustHint : <>
            👆 {mapPan ? t.panHint : fMode === "draw" ? t.fenceHint : P ? (fStart != null ? t.tapEnd : fSel.length || fRuns.length ? t.tapToggle : t.tapStart) : t.fenceHint}
            {fSel.some((r) => !r.full) || fRuns.length > 0 ? ` · ${t.dragHint}` : ""}
          </>}
        </p>
        <div className="relative rounded-2xl overflow-hidden mb-3" style={{ aspectRatio: `1280/${FH}`, background: C.navyDeep, cursor: "crosshair", touchAction: "none",
          // desktop: size the square map to the window so the action buttons
          // under it stay on screen — no scrolling mid-gesture at the office
          ...(isDesk ? { maxWidth: "min(100%, calc(100vh - 290px))", marginLeft: "auto", marginRight: "auto" } : {}) }}
          data-map="fence" onWheel={fMap.onWheel} onPointerDown={fMap.onPointerDown} onPointerMove={fMap.onPointerMove} onPointerUp={fMap.onPointerUp} onPointerCancel={fMap.onPointerUp}>
          <div className="absolute inset-0" style={fWrap}>
            {!fNoImg && (
              <img src={`/api/roofimg?lat=${fenceBase.lat}&lng=${fenceBase.lng}&zoom=${fenceBase.zoom}&r=${fImgN}${FH === 1280 ? "&sq=1" : ""}`} alt=""
                className="absolute inset-0 w-full h-full" draggable={false} onError={() => setFNoImg(true)} />
            )}
            {/* An unavailable aerial photo is an outage, not a "DEMO" — say so
                and offer a retry. Drawing still works over the plain map. */}
            {fNoImg && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <p className="text-xs font-bold" style={{ color: "#9DA8C4" }}>📡 {t.aerialFail}</p>
                <button onClick={() => { setFImgN(fImgN + 1); setFNoImg(false); }}
                  onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
                  className="rounded-xl px-4 py-2 text-xs font-extrabold active:scale-95"
                  style={{ background: "rgba(255,255,255,.92)", border: "none", color: C.navy }}>↻ {t.retryBtn}</button>
              </div>
            )}
            <svg viewBox={`0 0 ${TRACE_W} ${FH}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
              {/* Property line: RED dashed + small red corner pins — the
                  county's truth. Always visible, never moves; only the ORANGE
                  fence layer is editable. Two colors, two meanings. */}
              {P && (
                <g>
                  <polygon points={P.map((pt) => llToPx(pt, fenceBase)).map((p) => `${p[0]},${p[1]}`).join(" ")}
                    fill="none" stroke="#E5484D" strokeWidth="4" strokeDasharray="14 10" strokeLinecap="round" opacity=".9" />
                  {cornerIndexes(P, 45).map((ci, k3) => {
                    const h = llToPx(P[ci], fenceBase);
                    return <circle key={"rp" + k3} cx={h[0]} cy={h[1]} r="8" fill="#E5484D" stroke="#fff" strokeWidth="3" />;
                  })}
                </g>
              )}
              {/* Selected routes: thick orange over the neutral line, one
                  total-footage label at each route's midpoint. */}
              {P && fSel.map((r, ri) => {
                const { pts, closed } = routePts(r);
                const full = closed ? [...pts, pts[0]] : pts;
                const px = full.map((p) => llToPx(p, fenceBase));
                return (
                  <g key={"sel" + ri}>
                    <polyline points={px.map((p) => `${p[0]},${p[1]}`).join(" ")} fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" opacity=".85" />
                    <polyline points={px.map((p) => `${p[0]},${p[1]}`).join(" ")} fill="none" stroke={C.orange} strokeWidth="6" strokeLinecap="round" />
                    {/* per-side footage, like the paper sketch a builder trusts */}
                    {sideLabels(full).map((l, li) => (
                      <text key={"sl" + li} x={l.x} y={l.y} textAnchor="middle" fontSize="46" fontWeight="800" fill={C.navy}
                        stroke="#fff" strokeWidth="10" paintOrder="stroke" fontFamily="'Barlow Condensed',sans-serif">{l.ft}′</text>
                    ))}
                    {/* grab handles: drag to slide the fence start/end along the
                        lot line. The pulse says "I move" without a tutorial. */}
                    {!closed && [px[0], px[px.length - 1]].map((h, hi) => (
                      <g key={"h" + hi}>
                        <circle cx={h[0]} cy={h[1]} r="24" fill="none" stroke="#fff" strokeWidth="4" opacity=".8">
                          <animate attributeName="r" values="24;38;24" dur="1.6s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values=".8;0;.8" dur="1.6s" repeatCount="indefinite" />
                        </circle>
                        <circle cx={h[0]} cy={h[1]} r="24" fill="#fff" stroke={C.orange} strokeWidth="9" />
                      </g>
                    ))}
                    {/* full perimeter: pulsing corner dots — tap a side to drop it */}
                    {closed && cornerIndexes(P, 45).map((ci, k2) => {
                      const h = llToPx(P[ci], fenceBase);
                      return (
                        <g key={"cd" + k2}>
                          <circle cx={h[0]} cy={h[1]} r="18" fill="none" stroke="#fff" strokeWidth="4" opacity=".8">
                            <animate attributeName="r" values="18;28;18" dur="1.6s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values=".8;0;.8" dur="1.6s" repeatCount="indefinite" />
                          </circle>
                          <circle cx={h[0]} cy={h[1]} r="18" fill="#fff" stroke={C.orange} strokeWidth="7" />
                        </g>
                      );
                    })}
                  </g>
                );
              })}
              {/* Pending start pin (two-tap selection) */}
              {P && fStart != null && (() => {
                const a = llToPx(P[fStart], fenceBase);
                return <g><circle cx={a[0]} cy={a[1]} r="16" fill="none" stroke={C.orange} strokeWidth="5" /><circle cx={a[0]} cy={a[1]} r="7" fill={C.orange} /></g>;
              })()}
              {[...fRuns, fCur].map((run, ri) => {
                const px = proj(run);
                const isCur = ri === fRuns.length;
                const isSel = fLineSel && ((fLineSel.set === "cur" && isCur) || (fLineSel.set === "runs" && fLineSel.i === ri));
                return (
                  <g key={ri}>
                    {px.length > 1 && <polyline points={px.map(p => `${p[0]},${p[1]}`).join(" ")} fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" opacity=".85" />}
                    {px.length > 1 && <polyline points={px.map(p => `${p[0]},${p[1]}`).join(" ")} fill="none" stroke={isSel ? C.red : C.orange} strokeWidth={isSel ? 7 : 5} strokeLinecap="round" strokeDasharray={isCur ? "16 10" : "none"} />}
                    {px.map((p, i) => {
                      const cl4 = run.length > 3 && run[0][0] === run[run.length - 1][0] && run[0][1] === run[run.length - 1][1];
                      if (cl4 && i === 0) return null; // dup start
                      // MAJOR corners (≥40° or open ends) get the big pulsing
                      // dot; small bends get quiet small dots — all draggable
                      const uq = cl4 ? run.slice(0, -1) : run;
                      const ui = cl4 ? i % uq.length : i;
                      let major = true;
                      const a2 = cl4 ? uq[(ui - 1 + uq.length) % uq.length] : run[i - 1];
                      const c2 = cl4 ? uq[(ui + 1) % uq.length] : run[i + 1];
                      if (a2 && c2) {
                        const kz = Math.PI / 180, cz = Math.cos(uq[ui][0] * kz);
                        const v1 = [(uq[ui][1] - a2[1]) * cz, uq[ui][0] - a2[0]], v2 = [(c2[1] - uq[ui][1]) * cz, c2[0] - uq[ui][0]];
                        const m1 = Math.hypot(...v1), m2 = Math.hypot(...v2);
                        major = !m1 || !m2 ? false :
                          (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)))) * 180) / Math.PI >= 40;
                      }
                      return (
                        <g key={i}>
                          {cl4 && major && (
                            <circle cx={p[0]} cy={p[1]} r={isDesk ? 10 : 16} fill="none" stroke="#fff" strokeWidth="4" opacity=".8">
                              <animate attributeName="r" values={isDesk ? "10;20;10" : "16;28;16"} dur="1.6s" repeatCount="indefinite" />
                              <animate attributeName="opacity" values=".8;0;.8" dur="1.6s" repeatCount="indefinite" />
                            </circle>
                          )}
                          {/* finger-sized dots on touch; slim ones under a mouse so they don't bury the map */}
                          <circle cx={p[0]} cy={p[1]} r={major ? (isDesk ? 10 : 16) : (isDesk ? 6 : 9)} fill="#fff" stroke={C.orange} strokeWidth={major ? (isDesk ? 4 : 6) : (isDesk ? 3 : 4)} />
                        </g>
                      );
                    })}
                    {(isCur ? labels(run) : sideLabels(run)).map((l, i) => (
                      <text key={"f" + i} x={l.x} y={l.y} textAnchor="middle" fontSize="46" fontWeight="800" fill={C.navy}
                        stroke="#fff" strokeWidth="10" paintOrder="stroke" fontFamily="'Barlow Condensed',sans-serif">{l.ft}′</text>
                    ))}
                  </g>
                );
              })}
              {/* Gates on the map (#11): a clear icon + width, tap to edit. */}
              {fGates.map((g, gi) => {
                // the gate IS its green line: two grab dots (stretch = custom
                // width), body drag moves it, width label always live
                const pa = llToPx(g.a, fenceBase), pb = llToPx(g.b, fenceBase);
                const on = gi === fGateEdit;
                const mx2 = (pa[0] + pb[0]) / 2, my2 = (pa[1] + pb[1]) / 2;
                return (
                  <g key={"g" + gi}>
                    <line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} stroke="#fff" strokeWidth="16" strokeLinecap="round" opacity=".9" />
                    <line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} stroke={on ? "#1E7B33" : "#2E9E44"} strokeWidth="10" strokeLinecap="round" />
                    {[pa, pb].map((e3, ei) => (
                      <circle key={ei} cx={e3[0]} cy={e3[1]} r={isDesk ? 10 : 16} fill="#fff" stroke="#2E9E44" strokeWidth={isDesk ? 4 : 6} />
                    ))}
                    <text x={mx2} y={my2 - 26} textAnchor="middle" fontSize="40" fontWeight="800" fill="#2E9E44"
                      stroke="#fff" strokeWidth="9" paintOrder="stroke" fontFamily="'Barlow Condensed',sans-serif">🚪 {Math.round(gateW(g))}′</text>
                  </g>
                );
              })}
              {/* Offset drag pointer: crosshair at the LANDING spot (above the
                  finger, never under it) + the live footage while dragging */}
              {fPtr && (
                <g pointerEvents="none">
                  <line x1={fPtr.fx} y1={fPtr.fy} x2={fPtr.x} y2={fPtr.y} stroke="#fff" strokeWidth="3" opacity=".65" />
                  <circle cx={fPtr.x} cy={fPtr.y} r="30" fill="none" stroke="#fff" strokeWidth="5" opacity=".95" />
                  <circle cx={fPtr.x} cy={fPtr.y} r="5" fill="#fff" />
                  {[[-46, 0, -32, 0], [46, 0, 32, 0], [0, -46, 0, -32], [0, 46, 0, 32]].map((l2, li) => (
                    <line key={li} x1={fPtr.x + l2[0]} y1={fPtr.y + l2[1]} x2={fPtr.x + l2[2]} y2={fPtr.y + l2[3]} stroke="#fff" strokeWidth="5" />
                  ))}
                  {fPtr.ft != null && <text x={fPtr.x} y={fPtr.y - 58} textAnchor="middle" fontSize="52" fontWeight="800" fill="#fff"
                    stroke={C.navy} strokeWidth="10" paintOrder="stroke" fontFamily="'Barlow Condensed',sans-serif">{fPtr.ft}′</text>}
                </g>
              )}
            </svg>
          </div>
          <div className="absolute right-2 top-2 flex flex-col gap-1.5" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
            <button onClick={() => setMapPan(!mapPan)} className="w-11 h-11 rounded-full text-lg active:scale-90" style={{ background: mapPan ? C.orange : "rgba(255,255,255,.92)", border: "none", boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>✋</button>
            <button onClick={() => zoomBy(1)} className="w-11 h-11 rounded-full text-xl font-extrabold active:scale-90" style={{ background: "rgba(255,255,255,.92)", border: "none", color: C.navy, boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>+</button>
            <button onClick={() => zoomBy(-1)} className="w-11 h-11 rounded-full text-xl font-extrabold active:scale-90" style={{ background: "rgba(255,255,255,.92)", border: "none", color: C.navy, boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>−</button>
            {/* 🧭 unlock: sometimes the county boundary sits offset from the
                photo — one drag moves lot + fence together, then re-locks */}
            {P && (
              <button onClick={() => setFAdjust(!fAdjust)} title={t.adjustLot} aria-label={t.adjustLot}
                className="w-11 h-11 rounded-full text-xl active:scale-90"
                style={{ background: fAdjust ? C.orange : "rgba(255,255,255,.92)", border: "none", boxShadow: "0 2px 8px rgba(0,0,0,.3)" }}>🧭</button>
            )}
          </div>
          {fenceBase.example && (
            <div className="absolute left-2 top-2 rounded-full px-3 py-1 text-[11px] font-extrabold tracking-wide"
              style={{ background: C.orange, color: C.navy }}>{t.exBadge} · {fenceBase.example}</div>
          )}
          {/* Tapped free line → its own delete chip (boundary sides keep the
              instant tap-toggle; a drawn line must not vanish by accident) */}
          {fLineSel && (() => {
            const pts = fLineSel.set === "cur" ? fCur : fRuns[fLineSel.i];
            if (!pts || pts.length < 2) return null;
            const m = llToPx(pts[Math.floor(pts.length / 2)], fenceBase);
            return (
              <button onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={deleteLine}
                className="absolute rounded-full px-4 py-2.5 text-sm font-extrabold active:scale-95"
                style={{ left: `${Math.min(88, Math.max(12, (m[0] / TRACE_W) * 100))}%`, top: `${Math.min(90, Math.max(8, (m[1] / FH) * 100))}%`,
                  transform: "translate(-50%, -150%)", background: "#fff", color: C.red, border: `2px solid ${C.red}`, boxShadow: "0 4px 14px rgba(0,0,0,.4)" }}>
                🗑 {t.delLine}
              </button>
            );
          })()}
        </div>
        {/* everything lives at the bottom: add fence, add gate, pencil toggle */}
        <div className="flex gap-2 mb-2">
          <button onClick={() => {
            // drop a ready-made straight line mid-screen — grab and place it
            pushHist();
            setFRuns([...fRuns, [pxToLl(TRACE_W / 2 - 160, FH / 2, fenceBase), pxToLl(TRACE_W / 2 + 160, FH / 2, fenceBase)]]);
          }} className="flex-1 rounded-xl py-2.5 text-sm font-bold active:scale-95"
            style={{ background: "#fff", border: `1.5px solid ${C.orange}`, color: C.orange }}>➕ {t.addFence}</button>
          <button onClick={spawnGate} className="flex-1 rounded-xl py-2.5 text-sm font-bold active:scale-95"
            style={{ background: "#fff", border: "1.5px solid #2E9E44", color: "#1E7B33" }}>➕ {t.addGate}</button>
          <button onClick={() => { setFMode(fMode === "draw" ? (P ? "sides" : "draw") : "draw"); setFStart(null); setFGateEdit(null); }}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold active:scale-95"
            style={{ background: fMode === "draw" ? C.navy : "#fff", color: fMode === "draw" ? "#fff" : C.navy, border: `1.5px solid ${fMode === "draw" ? C.navy : C.line}` }}>✏️ {t.modeDraw}</button>
        </div>
        <div className="flex gap-2 mb-3">
          <button onClick={undo} disabled={!fHist.length} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: fHist.length ? C.navy : C.slate }}>{t.undo}</button>
          <button onClick={clearAll} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.red }}>{t.clearAll}</button>
          {fCur.length >= 2 ? (
            <button onClick={endRun} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: C.orangeSoft, border: `1.5px solid ${C.orange}`, color: C.orange }}>➕ {t.newFence}</button>
          ) : P ? (
            <button onClick={selectFull} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy }}>⬜ {t.presetFull}</button>
          ) : (
            <button disabled className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.slate }}>{t.endRun}</button>
          )}
        </div>
        <button onClick={() => pickSurvey(fenceBase ? { lat: fenceBase.lat, lng: fenceBase.lng, addr: fenceBase.addr } : null)} disabled={surveyBusy}
          className="w-full rounded-xl py-2.5 text-sm font-bold mb-3 active:scale-95"
          style={{ background: "#fff", border: `1.5px solid ${C.navy}`, color: C.navy, opacity: surveyBusy ? 0.6 : 1 }}>
          {surveyBusy ? t.surveyReading : `📄 ${t.importSurvey}`}
        </button>
        {surveyInput}
        </div>
        <div>
        {/* Stat tiles, not a run-on sentence: hero number + one tile per fact.
            Values in the display face, labels small — scannable at a glance. */}
        <div className="rounded-2xl px-3 pt-3 pb-2.5 mb-3" style={{ background: C.navy }}>
          <div className="flex items-end justify-between mb-2.5 px-1">
            <div>
              <span className="block text-[11px] font-bold tracking-widest" style={{ color: "#9DA8C4" }}>{t.totalLF.toUpperCase()}</span>
              {q.gateFt > 0 && <span className="block text-[10px] font-semibold mt-0.5" style={{ color: "#7D89A6" }}>−{q.gateFt} ft {t.lineGates.toLowerCase()}</span>}
            </div>
            <span className="font-extrabold text-white leading-none" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 46 }}>
              {totalLF.toLocaleString()}<span style={{ fontSize: 24, color: "#9DA8C4" }}> ft</span>
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              // panels tile shows the ACTUAL product photo (the one picked in
              // the bottom row); tapping it opens details to edit the width
              [true, panels, t.panelsLbl, `${prodName(fType)} · ${fPanelW} ft`, () => setShowDetails(true)],
              [false, posts, t.posts, `${corners} ${t.cornerPosts.toLowerCase()}`],
              [false, fGates.length, fGates.length === 1 ? t.gate1 : t.gateN, fGates.length ? `${Math.round(fGates.reduce((s, g) => s + gateW(g), 0))} ft` : "—"],
            ].map(([withImg, val, lbl, sub, onTap], ti) => (
              <div key={ti} onClick={onTap} className="rounded-xl px-1 py-1.5 text-center" style={{ background: "rgba(255,255,255,.07)", cursor: onTap ? "pointer" : "default" }}>
                <div className="flex items-center justify-center gap-1.5 text-white font-extrabold leading-tight" style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24 }}>
                  {withImg && <img src={prodImgOf(fType)} alt="" draggable={false}
                    className="rounded-md object-cover" style={{ width: 22, height: 22, background: "#fff" }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                  <span>{val}</span>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#9DA8C4" }}>{lbl}</div>
                <div className="text-[10px] font-semibold" style={{ color: "#7D89A6" }}>{sub || " "}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Gate editor (#11): the sheet for the tapped gate — kind/width
            presets, custom width, delete. Recalculates immediately. */}
        {fGateEdit != null && fGates[fGateEdit] && (
          <div className="rounded-2xl p-3 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.orange}` }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-extrabold" style={{ color: C.navy }}>{t.gateEdit}</span>
              <button onClick={deleteGate} className="text-xs font-bold px-3 py-1 rounded-lg" style={{ color: C.red, border: `1.5px solid ${C.red}` }}>🗑 {t.delete}</button>
            </div>
            <div className="flex gap-2 mb-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {GATE_PRESETS.map((g, i) => {
                const on = Math.round(gateW(fGates[fGateEdit])) === g.widthFt;
                return (
                  <button key={i} onClick={() => editGate({ widthFt: g.widthFt })}
                    className="rounded-xl px-3 py-2 text-xs font-bold flex-shrink-0 active:scale-95"
                    style={{ background: on ? C.orangeSoft : C.bg, border: `1.5px solid ${on ? C.orange : C.line}`, color: on ? C.orange : C.navy }}>{g.label}</button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <Field label={t.gateWidth} value={String(Math.round(gateW(fGates[fGateEdit]) * 10) / 10)} onChange={(v) => editGate({ widthFt: Math.max(1, parseFloat(v) || 0) })} type="number" suffix="ft" />
              <Field label={t.gatePrice} value={String(fGates[fGateEdit].price ?? (gateKind(fGates[fGateEdit]) === "walk" ? parseFloat(fWalkP) || 0 : parseFloat(fDblP) || 0))} onChange={(v) => editGate({ price: parseFloat(v) || 0 })} type="number" />
            </div>
            <button onClick={() => setFGateEdit(null)} className="w-full mt-2 py-2 text-sm font-bold rounded-xl" style={{ background: C.navy, color: "#fff" }}>{t.done}</button>
          </div>
        )}
        {fGates.length > 0 && fGateEdit == null && (
          <p className="text-xs font-semibold mb-3" style={{ color: C.slate }}>🚪 {t.gateTapEdit}</p>
        )}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
          {fenceProdList().filter((pp) => pp.on !== false).map((pp) => {
            const k = pp.id;
            return (
            <button key={k} onClick={() => { setFType(k); setFLF(String(pp.price || 0)); setFPanelW(String(pp.panelW || 8)); }}
              className="rounded-xl text-xs font-bold active:scale-95 overflow-hidden flex-shrink-0"
              style={{ width: 104, padding: 0, background: fType === k ? C.orangeSoft : "#fff", border: fType === k ? `2.5px solid ${C.orange}` : `1.5px solid ${C.line}`, color: fType === k ? C.orange : C.navy }}>
              <img src={pp.img || `/fence/${k}.jpg`} alt="" draggable={false}
                style={{ width: "100%", height: 64, objectFit: "cover", display: "block", background: "#fff" }}
                onError={(e) => {
                  // HD photo failed to load → fall back to the built-in render
                  if (pp.img && !e.currentTarget.dataset.fb) { e.currentTarget.dataset.fb = 1; e.currentTarget.src = `/fence/${k}.jpg`; }
                  else e.currentTarget.style.display = "none";
                }} />
              <span className="block py-1.5 px-1 truncate">{pp.name}</span>
              <span className="block pb-1.5 text-[10px] font-semibold" style={{ color: fType === k ? C.orange : "#8A93A5" }}>${pp.price || 0}/ft</span>
            </button>
            );
          })}
          <button onClick={() => setFProdEdit(!fProdEdit)}
            className="rounded-xl text-xs font-bold active:scale-95 flex-shrink-0 flex flex-col items-center justify-center gap-1"
            style={{ width: 72, background: fProdEdit ? C.orangeSoft : "#fff", border: fProdEdit ? `2.5px solid ${C.orange}` : `1.5px solid ${C.line}`, color: fProdEdit ? C.orange : C.navy }}>
            <span style={{ fontSize: 20 }}>⚙️</span>
            <span className="px-1 text-center leading-tight">{t.prodTitle}</span>
          </button>
        </div>
        {fProdEdit && <FenceProductsCard closable />}
        <div className="rounded-2xl px-4 py-3 mb-3 flex items-center justify-between" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>{t.estTotal}</span>
          <span className="font-extrabold" style={{ color: C.orange, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 28 }}>{fmt(total)}</span>
        </div>
        <Btn disabled={totalLF === 0} onClick={() => {
          const title = `${t.lineFence} ${prodName(fType)}, ${totalLF} ft`;
          const lines = [[`${t.lineFence} ${prodName(fType)} (${totalLF} ft × $${lf$})`, fenceCost]];
          if (gatesCost) lines.push([`${t.lineGates} (${fGates.length})`, gatesCost]);
          if (mkAmt) lines.push([t.lineMarkup + ` (${fMk}%)`, mkAmt]);
          setPendingEstimate({
            title, lines, total, addr: fenceBase.addr || "",
            // 7 decimals ≈ 1 cm — measurement geometry must never lose footage
            // to coordinate rounding (5 decimals was ~1.1 m per point). Gates
            // ride along so the measurement sheet (commit 12) has them too.
            meas: { lat: fenceBase.lat, lng: fenceBase.lng, bbox: null,
              lines: allRuns.map(({ pts, closed }) => (closed ? [...pts, pts[0]] : pts).map(([a, b]) => [+a.toFixed(7), +b.toFixed(7)])),
              gates: fGates.map((g) => ({ kind: gateKind(g), widthFt: +gateW(g).toFixed(1), runIdx: gateRun(g),
                price: g.price ?? (gateKind(g) === "walk" ? parseFloat(fWalkP) || 0 : parseFloat(fDblP) || 0),
                a: [+g.a[0].toFixed(7), +g.a[1].toFixed(7)], b: [+g.b[0].toFixed(7), +g.b[1].toFixed(7)] })),
              netFt: totalLF, grossFt: q.grossFt, gateFt: q.gateFt,
              // everything the /f estimate document needs to redraw the map
              // and recompute the SAME quote server-side (shared fenceMath)
              parcel: fenceBase.parcel && fenceBase.parcel.length >= 3
                ? fenceBase.parcel.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]) : null,
              prod: prodName(fType), lfPrice: lf$,
              panelW: parseFloat(fPanelW) > 0 ? parseFloat(fPanelW) : 8,
              markupPct: parseFloat(fMk) || 0 },
          });
          setScreen("pickCustomer");
        }}>{t.toEstimate}</Btn>
        <button onClick={() => setShowDetails(!showDetails)} className="w-full py-3 text-sm font-bold" style={{ background: "none", border: "none", color: C.slate }}>{showDetails ? "▴ " : "▾ "}{t.adjustDetails}</button>
        {showDetails && (
          <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
            <div className="grid grid-cols-2 gap-x-3">
              <Field label={t.perLF} value={fLF} onChange={setFLF} type="number" />
              <Field label={t.panelWidth} value={fPanelW} onChange={setFPanelW} type="number" suffix="ft" />
              <Field label={t.markup} value={fMk} onChange={setFMk} type="number" suffix="%" />
              <Field label={t.walkPrice} value={fWalkP} onChange={setFWalkP} type="number" />
              <Field label={t.dblPrice} value={fDblP} onChange={setFDblP} type="number" />
            </div>
          </div>
        )}
        {/* Live material prices, one tap away — collapsed so it never crowds
            the screen; auto-fetches on first open (then it's cached all day).
            Anonymous funnel demo included: the server serves CACHED prices to
            anonymous visitors (never a fresh SerpApi call) — warm zip = the
            full 💲 wow moment during the 3 free tries, cold zip = the same
            local-prices fallback as before. */}
        <>
            <button onClick={() => { const nx = !fMatOpen; setFMatOpen(nx); if (nx && !fMat) loadHdPrices(); }}
              className="w-full py-3 text-sm font-bold" style={{ background: "none", border: "none", color: "#1E7B33" }}>
              {fMatOpen ? "▴ " : "▾ "}💲 {t.matBtn}
            </button>
            {fMatOpen && (
              <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
                {/* the drawn quote's numbers feed the takeoff: qty × HD price */}
                <HdPriceList takeoff={totalLF > 0 ? {
                  netFt: totalLF, postsTotal: posts, panels, gates: fGates.length, prod: fType,
                  // extras for the printable Hoja de materiales (/m): the
                  // house photos + the fence drawn over the aerial
                  addr: fenceBase.addr || "", grossFt: q.grossFt, gateFt: q.gateFt,
                  postsB: q.posts, corners, panelW: parseFloat(fPanelW) > 0 ? parseFloat(fPanelW) : 8,
                  lat: fenceBase.lat, lng: fenceBase.lng, zoom: fenceBase.zoom,
                  lines: allRuns.slice(0, 8).map(({ pts, closed }) => (closed ? [...pts, pts[0]] : pts).slice(0, 60).map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)])),
                } : null} />
              </div>
            )}
          </>
        {/* same one-tap drive as the roof card — the lot is on screen */}
        {(fenceBase.addr || fenceBase.lat != null) && (
          <button onClick={() => driveTo(fenceBase.addr, fenceBase.lat, fenceBase.lng)}
            className="w-full rounded-xl py-2.5 mt-1 text-sm font-bold active:scale-95"
            style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy }}>🗺️ {t.directions}</button>
        )}
        {P && <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "#9AA3B2" }}>{t.parcelDisclaimer}</p>}
        </div>
        </div>
      </div>
    );
  };

  const VoiceInvoice = () => (
    <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
      <div className="rounded-2xl p-5 mb-4 text-center" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
        <p className="text-sm font-bold mb-1" style={{ color: C.navy }}>{t.viSpeak}</p>
        <p className="text-xs mb-4" style={{ color: C.slate }}>{t.viExample}</p>
        <button onClick={() => recToggle((txt) => { setViHeard(txt); return viParse(txt); })}
          className="w-20 h-20 rounded-full text-4xl active:scale-90 transition-transform"
          style={{ background: recState === "rec" || listening ? C.red : C.orange, border: "none",
            boxShadow: recState === "rec" ? "0 0 0 8px rgba(217,48,37,.15)" : "0 6px 16px rgba(248,180,8,.4)",
            animation: recState === "rec" ? "ttpPulse 1.2s ease-in-out infinite" : "none" }}>
          {recState === "busy" ? "⏳" : recState === "rec" || listening ? "🔴" : "🎤"}
        </button>
        {recState === "rec" && <p className="text-sm font-extrabold mt-3" style={{ color: C.red }}>{t.recStop}</p>}
        {(recState === "busy" || viBusy) && <p className="text-sm font-semibold mt-3" style={{ color: C.slate }}>{recState === "busy" && !viBusy ? t.transcribing : t.aiThinking}</p>}
        {viHeard && !viBusy && recState === "idle" && <p className="text-sm mt-3" style={{ color: C.slate }}>{t.viHeard}: “{viHeard}”</p>}
      </div>
      <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
        <Field label={t.cust} value={viName} onChange={setViName} placeholder="María García" />
        {viName.trim().length >= 1 && !customers.some(c => c.name.toLowerCase() === viName.trim().toLowerCase()) && (
          <div className="flex gap-1.5 flex-wrap mb-2" style={{ marginTop: -6 }}>
            {customers.filter(c => c.name.toLowerCase().includes(viName.trim().toLowerCase())).slice(0, 3).map(c => (
              <button key={c.id} onClick={() => setViName(c.name)} className="rounded-full px-3 py-1.5 text-xs font-bold"
                style={{ background: C.orangeSoft, color: C.orange, border: "none" }}>👤 {c.name}</button>
            ))}
          </div>
        )}
      </div>
      {viLines.length > 0 && (
        <div className="rounded-2xl px-4 py-2 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
          {viLines.map(([cpt, amt], i) => (
            <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
              <span className="text-sm font-semibold flex-1 min-w-0 truncate" style={{ color: C.navy }}>{cpt}</span>
              <span className="font-bold px-2" style={{ color: C.navy }}>{fmt(amt)}</span>
              <button onClick={() => setViLines(viLines.filter((_, j) => j !== i))} className="text-base font-bold px-1" style={{ background: "none", border: "none", color: C.red }}>✕</button>
            </div>
          ))}
          <div className="flex justify-between py-2">
            <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18 }}>{t.estTotal}</span>
            <span className="font-extrabold" style={{ color: C.orange, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 20 }}>
              {fmt(viLines.reduce((s2, [, v]) => s2 + v, 0) + (Math.round(parseFloat(viAmount) || 0) > 0 ? Math.round(parseFloat(viAmount)) : 0))}
            </span>
          </div>
        </div>
      )}
      <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
        <Field label={t.concept} value={viConcept} onChange={setViConcept} placeholder={lang === "es" ? "Reparación de techo" : "Roof repair"} />
        <Field label={t.amount + " ($)"} value={viAmount} onChange={setViAmount} type="number" placeholder="450" />
        <button onClick={viAddLine} disabled={!viConcept.trim() || !(parseFloat(viAmount) > 0)}
          className="w-full rounded-xl py-2.5 text-sm font-extrabold active:scale-95 transition-transform"
          style={{ background: "none", border: `2px dashed ${viConcept.trim() && parseFloat(viAmount) > 0 ? C.orange : C.line}`, color: viConcept.trim() && parseFloat(viAmount) > 0 ? C.orange : C.slate }}>
          {t.viAddLine}
        </button>
      </div>
      {/* Optional house photos: geocode once, show the two shots, tap to
          include/exclude — the document comes out looking like a site visit. */}
      <div className="rounded-2xl p-4 mb-3" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
        <p className="text-xs font-bold tracking-widest mb-1" style={{ color: C.orange }}>📍 {t.viPhotosT}</p>
        <p className="text-xs mb-2" style={{ color: C.slate }}>{t.viPhotosSub}</p>
        <div className="flex gap-2">
          <input value={viAddr} onChange={(e) => setViAddr(e.target.value)} placeholder={t.viAddrPh}
            onKeyDown={(e) => { if (e.key === "Enter") viFindHouse(); }}
            className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ border: `1.5px solid ${C.line}`, outline: "none", color: C.navy }} />
          <button onClick={viFindHouse} disabled={viGeoBusy || !viAddr.trim()}
            className="rounded-xl px-4 text-base font-extrabold active:scale-95 transition-transform"
            style={{ background: C.navy, color: "#fff", border: "none", opacity: viGeoBusy || !viAddr.trim() ? 0.55 : 1 }}>{viGeoBusy ? "…" : "🔍"}</button>
        </div>
        {viLoc && (<>
          <p className="text-xs font-semibold mt-2" style={{ color: C.slate }}>📍 {viLoc.formatted}</p>
          <p className="text-xs font-semibold mt-2 mb-1" style={{ color: C.slate }}>{t.viPhotosPick}</p>
          <div className="grid grid-cols-2 gap-2">
            {[[t.viStreet, `/api/streetview?lat=${viLoc.lat}&lng=${viLoc.lng}`, viImgStr, setViImgStr],
              [t.viAerial, `/api/roofimg?lat=${viLoc.lat}&lng=${viLoc.lng}&zoom=20`, viImgAer, setViImgAer]].map(([lb, src, on, set], i2) => (
              <button key={i2} onClick={() => set(!on)} className="relative rounded-xl overflow-hidden active:scale-95 transition-transform"
                style={{ border: `2.5px solid ${on ? C.orange : C.line}`, background: C.bg, padding: 0, opacity: on ? 1 : 0.45, minHeight: 60 }}>
                <img src={src} alt="" style={{ width: "100%", height: 96, objectFit: "cover", display: "block" }}
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <span className="absolute rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ left: 6, bottom: 6, background: on ? C.orange : "#fff", color: on ? "#fff" : C.slate, boxShadow: "0 1px 4px rgba(0,0,0,.25)" }}>{on ? "✓ " : ""}{lb}</span>
              </button>
            ))}
          </div>
          <button onClick={() => { setViLoc(null); setViAddr(""); }} className="text-xs font-bold mt-2" style={{ background: "none", border: "none", color: C.slate }}>✕ {t.viClear}</button>
        </>)}
      </div>
      <div className="grid gap-2.5">
        <Btn onClick={() => viCreate("inv")} disabled={!viLines.length && !(viConcept.trim() && parseFloat(viAmount) > 0)}>{t.createInvoice}</Btn>
        <Btn color="#fff" textColor={C.navy} style={{ border: `1.5px solid ${C.line}` }}
          onClick={() => viCreate("est")} disabled={!viLines.length && !(viConcept.trim() && parseFloat(viAmount) > 0)}>{t.viCreateEst}</Btn>
      </div>
    </div>
  );

  const AI = () => {
    const empty = aiMsgs.length === 0;
    return (
    <div className="flex-1 flex flex-col px-5 pb-4 overflow-hidden">
      {empty ? (
        // Welcome state: greeting + suggestions centered in the middle. Once a
        // question is asked, this collapses into a normal chat thread.
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <span className="text-5xl mb-2">🎙️</span>
          <p className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26 }}>{t.askTTP}</p>
          <p className="text-sm font-semibold mt-1 mb-5" style={{ color: C.slate }}>{t.aiWelcome}</p>
          <div className="w-full grid gap-2" style={{ maxWidth: 360 }}>
            {[t.aiChip1, t.aiChip2, t.aiChip3, t.aiChip4, t.aiChip5].map(chip => (
              <button key={chip} onClick={() => askAI(chip)} className="rounded-xl px-4 py-3 text-sm font-bold text-left active:scale-95 transition-transform"
                style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy }}>💬 {chip}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="app-scroll flex-1 overflow-y-auto py-2">
          {aiMsgs.map((m, i) => (
            <div key={i} className={`flex mb-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="rounded-2xl px-4 py-2.5 max-w-xs text-sm font-medium whitespace-pre-wrap"
                style={m.role === "user" ? { background: C.navy, color: "#fff" } : { background: "#fff", color: C.navy, border: `1.5px solid ${C.line}` }}>
                {m.content}
              </div>
            </div>
          ))}
          {aiBusy && <p className="text-sm font-semibold" style={{ color: C.slate }}>{t.aiThinking}</p>}
        </div>
      )}
      <div className="flex gap-2 items-center pt-1">
        <button onClick={() => recToggle((txt) => { setAiInput(""); return askAI(txt); })} aria-label="speak"
          className="rounded-xl active:scale-90 transition-transform shrink-0 flex items-center justify-center"
          style={{ width: 48, height: 48, background: recState === "rec" ? C.red : C.orangeSoft, border: "none", fontSize: 22,
            animation: recState === "rec" ? "ttpPulse 1.2s ease-in-out infinite" : "none" }}>
          {recState === "busy" ? "⏳" : recState === "rec" ? "🔴" : "🎤"}
        </button>
        <input value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => e.key === "Enter" && askAI(aiInput)}
          placeholder={t.aiHint} className="flex-1 min-w-0 rounded-xl px-4 py-3 text-sm font-semibold outline-none"
          style={{ background: "#fff", border: `1.5px solid ${C.line}`, color: C.navy }} />
        <button onClick={() => askAI(aiInput)} disabled={aiBusy} className="rounded-xl px-4 py-3 font-extrabold shrink-0" style={{ background: C.orange, color: "#fff", border: "none" }}>→</button>
      </div>
    </div>
    );
  };

  const Leads = () => {
    const prettyPhone = (p) => {
      const d = String(p || "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
      return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
    };
    const when = (ts) => {
      // Always date AND time — the contractor wants to know exactly when it
      // came in ("today" beats a bare date for fresh ones).
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "";
      const loc = lang === "es" ? "es-MX" : "en-US";
      const time = d.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit" });
      const sameDay = d.toDateString() === new Date().toDateString();
      const day = sameDay ? (lang === "es" ? "Hoy" : "Today") : d.toLocaleDateString(loc, { month: "short", day: "numeric" });
      return `${day} · ${time}`;
    };
    const waLink = (l) => {
      const d = String(l.phone || "").replace(/\D/g, "");
      const who = userName && bizName ? `${userName} (${bizName})` : (bizName || userName || "ALTO Pro");
      return `https://wa.me/${d.length === 10 ? "1" + d : d}?text=${encodeURIComponent(t.leadMsg(l.name, l.address, who))}`;
    };
    // ── Desktop: the CRM board. Same stages, same markLead — columns instead
    // of buttons, native mouse drag to move a lead through the pipeline. The
    // phone keeps the month folders untouched (drag is a mouse gesture).
    if (isDesk) {
      const COLS = [
        ["new", "🆕 " + t.boardNew],
        ["contacted", "📞 " + t.stContacted],
        ["interested", "💬 " + t.stInterested],
        ["hot", t.stHot],
        ["lost", "❌ " + t.lostFolder],
      ];
      const sorted = [...leads].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      const colBg = (st, over) => (over ? "#FEF5DC" : st === "lost" ? "#EEF0F3" : "#EDF1F7");
      return (
        <div className="flex-1 flex flex-col px-5 pb-4" style={{ minHeight: 0 }}>
          <p className="text-xs font-bold mb-2" style={{ color: C.slate }}>🖱️ {t.boardHint}</p>
          <div className="flex gap-3 flex-1" style={{ minHeight: 0, overflowX: "auto" }}>
            {COLS.map(([st, label]) => {
              const cards = sorted.filter((l) => (l.status || "new") === st);
              return (
                <div key={st} data-col={st} className="flex flex-col rounded-2xl"
                  style={{ flex: 1, minWidth: 210, minHeight: 0, background: colBg(st, false), border: `1.5px solid ${C.line}`, opacity: st === "lost" ? 0.75 : 1 }}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = colBg(st, true); }}
                  onDragLeave={(e) => { e.currentTarget.style.background = colBg(st, false); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.background = colBg(st, false);
                    const id = e.dataTransfer.getData("text/plain");
                    const lead = leads.find((l) => String(l.id) === id);
                    if (lead && (lead.status || "new") !== st) markLead(lead.id, st);
                  }}>
                  <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                    <span className="text-xs font-extrabold tracking-wide" style={{ color: C.navy }}>{label}</span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-extrabold"
                      style={{ background: st === "new" && cards.length ? C.orange : "#fff", color: st === "new" && cards.length ? "#fff" : C.slate, border: st === "new" && cards.length ? "none" : `1px solid ${C.line}` }}>{cards.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 pb-2" style={{ minHeight: 0 }}>
                    {cards.map((l) => (
                      <div key={l.id} draggable data-lead={l.id}
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(l.id)); e.dataTransfer.effectAllowed = "move"; }}
                        className="rounded-xl p-3 mb-2"
                        style={{ background: "#fff", border: `1.5px solid ${l.status === "new" || !l.status ? C.orange : C.line}`, cursor: "grab" }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold truncate" style={{ color: C.navy, fontSize: 14.5 }}>{l.name || prettyPhone(l.phone)}</span>
                          <button onClick={() => { if (!window.confirm(t.delLeadQ)) return; setLeads((ls) => ls.filter((x) => x.id !== l.id)); api(`/api/leads/${l.id}`, { method: "POST", body: JSON.stringify({ status: "deleted" }) }).catch(() => {}); }}
                            className="text-xs shrink-0" style={{ background: "none", border: "none", color: "#B9C0CE", cursor: "pointer" }} aria-label="delete lead">🗑</button>
                        </div>
                        <p className="text-xs font-semibold mt-0.5" style={{ color: C.slate }}>{prettyPhone(l.phone)} · {when(l.created_at)}</p>
                        {l.address && <p className="text-xs font-semibold mt-1 truncate" style={{ color: C.slate }}>📍 {l.address}</p>}
                        {l.info?.fenceFt != null && (
                          <p className="text-xs font-bold mt-1" style={{ color: "#1E7B33" }}>🛰️ {Number(l.info.fenceFt).toLocaleString()} ft{l.info.material ? ` · ${l.info.material}` : ""}</p>
                        )}
                        {l.info?.low != null && (
                          <p className="text-xs font-bold mt-0.5" style={{ color: C.slate }}>{t.leadEst}: {fmt(l.info.low)}–{fmt(l.info.high)}</p>
                        )}
                        <div className="flex gap-1.5 mt-2">
                          <a href={waLink(l)} target="_blank" rel="noreferrer" onClick={() => (l.status === "new" || !l.status) && markLead(l.id, "contacted")}
                            className="flex-1 rounded-lg py-1.5 text-center text-xs font-bold no-underline" style={{ background: C.bg, color: "#1FAF52" }}>💬</a>
                          <a href={`tel:+1${String(l.phone || "").replace(/\D/g, "").replace(/^1/, "")}`} onClick={() => (l.status === "new" || !l.status) && markLead(l.id, "contacted")}
                            className="flex-1 rounded-lg py-1.5 text-center text-xs font-bold no-underline" style={{ background: C.bg, color: C.navy }}>📞</a>
                          {l.address && (
                            <button onClick={() => driveTo(l.address)} className="flex-1 rounded-lg py-1.5 text-xs font-bold" style={{ background: C.bg, color: C.navy, border: "none", cursor: "pointer" }}>🗺️</button>
                          )}
                          <button onClick={() => convertLead(l)} title={t.leadQuote} className="flex-1 rounded-lg py-1.5 text-xs font-bold" style={{ background: C.orangeSoft, color: C.orange, border: "none", cursor: "pointer" }}>🛰️</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {leads.length === 0 && (
            <div className="text-center mt-10">
              <span className="text-5xl">📥</span>
              <p className="font-bold mt-3" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22 }}>{t.leadsEmpty}</p>
              <p className="text-sm mt-2 font-semibold" style={{ color: C.slate }}>{t.leadsEmptySub}</p>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-6">
        {leads.length === 0 && (
          <div className="text-center mt-12 px-6">
            <span className="text-5xl">📥</span>
            <p className="font-bold mt-3" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22 }}>{t.leadsEmpty}</p>
            <p className="text-sm mt-2 font-semibold" style={{ color: C.slate }}>{t.leadsEmptySub}</p>
          </div>
        )}
        {(() => {
          // Mini-CRM: leads live in month "folders" — newest month open, older
          // ones collapsed. Every lead keeps its arrival date and a stage.
          // "No interesado" leads leave the monthly folders and rest in their
          // own collapsed drawer at the bottom — out of sight, never lost.
          const activeLeads = leads.filter((l) => l.status !== "lost");
          const lostLeads = leads.filter((l) => l.status === "lost");
          const byMonth = new Map();
          activeLeads.forEach((l) => {
            const d2 = new Date(l.created_at);
            const k = Number.isNaN(d2.getTime()) ? -1 : d2.getFullYear() * 12 + d2.getMonth();
            if (!byMonth.has(k)) byMonth.set(k, []);
            byMonth.get(k).push(l);
          });
          const keys = [...byMonth.keys()].sort((a, b) => b - a);
          const open = leadOpenMonths || (keys.length ? [keys[0]] : []);
          const monthName = (k) => {
            if (k === -1) return "—";
            const nm = new Date(Math.floor(k / 12), k % 12, 1).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric" });
            return nm.charAt(0).toUpperCase() + nm.slice(1);
          };
          const toggle = (k) => setLeadOpenMonths(open.includes(k) ? open.filter((x) => x !== k) : [...open, k]);
          // One accent (orange = new lead) — everything else stays navy/gray
          // so the list reads calm instead of like a traffic light.
          const STAGES = [["contacted", t.stContacted], ["interested", t.stInterested], ["hot", t.stHot], ["lost", t.stLost]];
          const folders = keys.map((k) => {
            const list = byMonth.get(k);
            const nNew = list.filter((l) => l.status === "new").length;
            const isOpen = open.includes(k);
            return (
              <div key={k} className="mb-3">
                <button onClick={() => toggle(k)} className="w-full rounded-2xl px-4 py-3 flex items-center gap-2"
                  style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
                  <span className="text-base">{isOpen ? "📂" : "📁"}</span>
                  <span className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19 }}>{monthName(k)}</span>
                  <span className="text-xs font-bold" style={{ color: C.slate }}>· {list.length} leads</span>
                  {nNew > 0 && <span className="rounded-full px-2 py-0.5 text-xs font-extrabold" style={{ background: C.orange, color: "#fff" }}>{nNew} {t.leadNew.toLowerCase()}</span>}
                  <span className="ml-auto font-extrabold" style={{ color: C.slate }}>{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen && list.map((l) => {
                  // Collapsed = just name, phone and when it came in. Tap to
                  // expand the full card (address, estimate, actions, stage).
                  const expanded = leadOpenId === l.id;
                  return (
                  <div key={l.id} className="rounded-2xl px-4 py-3 mt-2" style={{ background: "#fff", border: `1.5px solid ${C.line}` }}>
                    <button onClick={() => setLeadOpenId(expanded ? null : l.id)} className="w-full flex items-center gap-2 text-left" style={{ background: "none", border: "none", padding: 0 }}>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-extrabold truncate" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19 }}>{l.name || prettyPhone(l.phone)}</span>
                          {l.status === "new" && <span className="rounded-full px-2 py-0.5 text-xs font-extrabold shrink-0" style={{ background: C.orange, color: "#fff" }}>{t.leadNew}</span>}
                        </span>
                        <span className="block text-sm font-semibold" style={{ color: C.slate }}>{l.name ? prettyPhone(l.phone) + " · " : ""}{when(l.created_at)}</span>
                      </span>
                      <span className="font-extrabold shrink-0" style={{ color: C.slate }}>{expanded ? "▾" : "▸"}</span>
                    </button>
                    {expanded && (<>
                    {l.address && <p className="text-sm font-semibold mt-2" style={{ color: C.slate }}>📍 {l.address}</p>}
                    {/* a widget lead that MEASURED their own fence is hot —
                        show what they picked right on the card */}
                    {l.info?.fenceFt != null && (
                      <p className="text-sm font-bold mt-1" style={{ color: "#1E7B33" }}>🛰️ {Number(l.info.fenceFt).toLocaleString()} ft{l.info.material ? ` · ${l.info.material}` : ""}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {l.info?.low != null && (
                        <span className="text-sm font-bold" style={{ color: C.slate }}>{t.leadEst}: {fmt(l.info.low)}–{fmt(l.info.high)}</span>
                      )}
                      <button onClick={() => { if (!window.confirm(t.delLeadQ)) return; setLeads((ls) => ls.filter((x) => x.id !== l.id)); api(`/api/leads/${l.id}`, { method: "POST", body: JSON.stringify({ status: "deleted" }) }).catch(() => {}); }}
                        className="ml-auto text-sm font-bold" style={{ background: "none", border: "none", color: C.slate }} aria-label="delete lead">🗑</button>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <a href={waLink(l)} target="_blank" rel="noreferrer" onClick={() => l.status === "new" && markLead(l.id, "contacted")}
                        className="flex-1 rounded-xl py-2.5 text-center text-sm font-bold no-underline" style={{ background: "#fff", color: "#1FAF52", border: `1.5px solid ${C.line}` }}>💬 {t.leadWhats}</a>
                      <a href={`tel:+1${String(l.phone || "").replace(/\D/g, "").replace(/^1/, "")}`} onClick={() => l.status === "new" && markLead(l.id, "contacted")}
                        className="flex-1 rounded-xl py-2.5 text-center text-sm font-bold no-underline" style={{ background: "#fff", color: C.navy, border: `1.5px solid ${C.line}` }}>📞 {t.leadCall}</a>
                    </div>
                    {l.address && (
                      <button onClick={() => driveTo(l.address)} className="w-full rounded-xl py-2.5 mt-2 text-sm font-bold active:scale-95 transition-transform"
                        style={{ background: "#fff", color: C.navy, border: `1.5px solid ${C.line}` }}>🗺️ {t.directions}</button>
                    )}
                    <button onClick={() => convertLead(l)} className="w-full rounded-xl py-2.5 mt-2 text-sm font-bold active:scale-95 transition-transform"
                      style={{ background: "#fff", color: C.navy, border: `1.5px solid ${C.line}` }}>🛰️ {t.leadQuote}</button>
                    <div className="grid grid-cols-2 gap-1.5 mt-2">
                      {STAGES.map(([v, lb]) => (
                        <button key={v} onClick={() => markLead(l.id, l.status === v ? "contacted" : v)}
                          className="rounded-lg px-1 py-2 text-xs font-bold active:scale-95 transition-transform"
                          style={{ background: l.status === v ? C.navy : C.bg, color: l.status === v ? "#fff" : C.slate, border: "none" }}>{lb}</button>
                      ))}
                    </div>
                    </>)}
                  </div>
                  );
                })}
              </div>
            );
          });
          const lostOpen = open.includes("lost");
          const lostFolder = lostLeads.length ? (
            <div key="lost" className="mb-3">
              <button onClick={() => toggle("lost")} className="w-full rounded-2xl px-4 py-3 flex items-center gap-2"
                style={{ background: C.bg, border: `1.5px dashed ${C.line}` }}>
                <span className="text-base">🚫</span>
                <span className="font-bold" style={{ color: C.slate, fontSize: 15 }}>{t.lostFolder}</span>
                <span className="text-xs font-bold" style={{ color: C.slate }}>· {lostLeads.length}</span>
                <span className="ml-auto font-extrabold" style={{ color: C.slate }}>{lostOpen ? "▾" : "▸"}</span>
              </button>
              {lostOpen && lostLeads.map((l) => (
                <div key={l.id} className="rounded-2xl px-4 py-3 mt-2 flex items-center gap-2" style={{ background: "#fff", border: `1.5px solid ${C.line}`, opacity: 0.75 }}>
                  <div className="flex-1 min-w-0">
                    <span className="block text-sm font-bold truncate" style={{ color: C.slate }}>{l.name || prettyPhone(l.phone)}</span>
                    <span className="text-xs font-semibold" style={{ color: C.slate }}>{prettyPhone(l.phone)} · {when(l.created_at)}</span>
                  </div>
                  <button onClick={() => markLead(l.id, "contacted")} className="text-xs font-bold rounded-lg px-2.5 py-2" style={{ background: C.bg, border: "none", color: C.navy }}>{t.leadRestore}</button>
                  <button onClick={() => { if (!window.confirm(t.delLeadQ)) return; setLeads((ls) => ls.filter((x) => x.id !== l.id)); api(`/api/leads/${l.id}`, { method: "POST", body: JSON.stringify({ status: "deleted" }) }).catch(() => {}); }}
                    className="text-sm font-bold" style={{ background: "none", border: "none", color: C.slate }} aria-label="delete lead">🗑</button>
                </div>
              ))}
            </div>
          ) : null;
          return [...folders, lostFolder];
        })()}
      </div>
    );
  };

  // "Mi página web": share the contractor's own public pages so a homeowner can
  // self-quote (the lead lands back in the app). Two surfaces: the satellite
  // quote tool (/w/) to send to clients, and the full branded website (/site/).
  const WebShare = () => {
    const base = window.location.origin;
    const mySlug = slug || "alto-demo";
    const quoteLink = `${base}/w/${mySlug}`;
    const siteLink = `${base}/site/${mySlug}`;
    const opinaLink = `${base}/opina/${mySlug}`;
    const copy = async (link) => {
      try { await navigator.clipboard.writeText(link); showToast("🔗 " + t.linkCopied); } catch { /* ignore */ }
    };
    const msgFor = (link) => (link === opinaLink ? t.revMsg(bizName || "ALTO Pro") : t.webMsg(bizName || "ALTO Pro")) + " " + link;
    // Send straight to WhatsApp (true WhatsApp, not a generic share sheet).
    const shareWA = (link) => { window.open("https://wa.me/?text=" + encodeURIComponent(msgFor(link)), "_blank"); };
    // Send by SMS / text — opens the phone's Messages app with the link prefilled.
    const shareSMS = (link) => { window.location.href = "sms:?&body=" + encodeURIComponent(msgFor(link)); };
    // Preview in the same window with ?app=1 so the public page shows a
    // "‹ Volver a la app" button and the contractor is never stranded.
    const preview = (link) => { window.location.href = link + (link.includes("?") ? "&" : "?") + "app=1"; };
    // The page itself is the hero: a live preview the contractor can tap to open
    // full. The send buttons sit underneath, compact, so they don't take over.
    const card = (icon, title, sub, link, accent) => (
      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderTop: `4px solid ${accent}`, boxShadow: "0 6px 20px rgba(16,27,48,.07)" }}>
        <button onClick={() => preview(link)} className="block w-full relative" style={{ height: 220, overflow: "hidden", background: C.bg, border: "none", padding: 0, cursor: "pointer" }}>
          <iframe src={link} title={title} scrolling="no" tabIndex={-1} style={{ width: "100%", height: 470, border: 0, pointerEvents: "none" }} />
          <span className="absolute font-bold" style={{ right: 10, bottom: 10, fontSize: 12, background: C.navy, color: "#fff", padding: "7px 12px", borderRadius: 99, boxShadow: "0 4px 12px rgba(16,27,48,.3)" }}>👁️ {t.webView}</span>
        </button>
        <div className="px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{icon}</span>
            <h2 className="font-extrabold" style={{ color: C.navy, fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22 }}>{title}</h2>
          </div>
          <p className="text-sm font-semibold mt-1 mb-3" style={{ color: C.slate, lineHeight: 1.4 }}>{sub}</p>
          <div className="flex gap-2">
            <Btn onClick={() => shareWA(link)} color="#25D366" style={{ flex: 1, padding: "11px 4px", fontSize: 15, letterSpacing: 0 }}>💬 {t.webSendWA}</Btn>
            <Btn onClick={() => shareSMS(link)} color={C.navy} style={{ flex: 1, padding: "11px 4px", fontSize: 15, letterSpacing: 0 }}>✉️ {t.webSendSMS}</Btn>
          </div>
          <button onClick={() => copy(link)} className="w-full text-center mt-3 font-bold" style={{ background: "none", border: "none", color: C.slate, fontSize: 13 }}>🔗 {t.webCopy}</button>
        </div>
      </div>
    );
    return (
      <div className="app-scroll flex-1 overflow-y-auto px-5 pb-8">
        <p className="text-sm font-semibold mt-1 mb-4 text-center" style={{ color: C.slate }}>{t.webIntro}</p>
        {card("🛰️", t.webQuoteT, t.webQuoteSub, quoteLink, C.orange)}
        {/* Middle divider: turn the two cards into a clear either/or */}
        <div className="flex items-center gap-3 my-5">
          <span className="flex-1" style={{ height: 1.5, background: C.line }} />
          <span className="text-xs font-extrabold text-center" style={{ color: C.slate, maxWidth: 180, lineHeight: 1.3 }}>{t.webChoose}</span>
          <span className="flex-1" style={{ height: 1.5, background: C.line }} />
        </div>
        {card("🌐", t.webSiteT, t.webSiteSub, siteLink, "#2E7CF6")}
        <div className="flex items-center gap-3 my-5">
          <span className="flex-1" style={{ height: 1.5, background: C.line }} />
          <span className="text-xs font-extrabold text-center" style={{ color: C.slate, maxWidth: 200, lineHeight: 1.3 }}>{t.revDivider}</span>
          <span className="flex-1" style={{ height: 1.5, background: C.line }} />
        </div>
        {card("⭐", t.revT, t.revSub, opinaLink, "#F8B408")}
        <p className="text-center text-xs font-semibold mt-6" style={{ color: "#A9B1C2" }}>{t.webShareNote}</p>
      </div>
    );
  };

  /* ── Router ── */
  const titles = {
    calc: "⚡ " + t.quickQuote, pickCustomer: t.estimate, send: t.estimate, jobs: t.jobs,
    jobDetail: t.job, invoice: t.invoice, payments: t.payments, customers: t.customers, ai: t.askTTP,
    roofAddress: "🛰️ " + (trade === "fence" ? t.measureFence : t.measureTitle),
    trace: "✏️ " + t.traceTitle, voiceInvoice: "🎤 " + t.quickInvoice, fenceDraw: "🪵 " + t.fenceTitle,
    fenceConfirm: "📍 " + t.confirmScreenT,
    pickHouse: "🏠 " + t.pickHouseTitle,
    settings: "⚙️ " + t.settings, leads: "📥 " + t.leads, webShare: "🌐 " + t.webShareTitle,
  };
  const backMap = {
    calc: "home", pickCustomer: trade === "fence" ? "fenceDraw" : "calc", send: "jobs", jobs: "home", jobDetail: "jobs",
    invoice: "jobDetail", payments: "home", customers: "home", ai: "home", roofAddress: "home",
    // Back from the fence map returns to the confirmation (when there was
    // one) or the address screen — NEVER dumps the contractor on home with
    // the address lost. Selections survive (openFence keeps same-parcel state).
    trace: "calc", voiceInvoice: "home", fenceDraw: fConfirm ? "fenceConfirm" : "roofAddress", fenceConfirm: "roofAddress",
    settings: "home", leads: "home", webShare: "home",
    pickHouse: "calc",
  };
  const withNav = ["home", "jobs", "payments", "customers", "settings", "leads"];

  // Desktop fills the WHOLE window: sidebar pinned to the left edge, the
  // app's light canvas covering everything else, and the content centered on
  // it at a readable width (buttons must not stretch across a 27" monitor).
  // On the phone: the same single centered column as always.
  const deskShell = isDesk && !accountPaused && !["boot", "onboard", "trade"].includes(screen);
  const colMaxW = deskShell
    ? (screen === "fenceDraw" || screen === "leads" || (screen === "calc" && trade === "roofing") ? 1500
      : ["home", "jobs", "customers", "payments", "trace", "jobDetail", "send"].includes(screen) ? 1080 : 780)
    : 448;
  const appCol = (
      <div className="w-full flex flex-col relative" style={{ background: C.bg, height: "100%", overflow: "hidden", maxWidth: colMaxW }}>
        {accountPaused ? (
          <div className="flex flex-col items-center justify-center flex-1 px-6 text-center"
            style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #EFF2F7 100%)", minHeight: "100vh" }}>
            <img src="/brand-logo.png" alt="ALTO Pro" style={{ maxWidth: 220, margin: "0 auto 18px" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <div className="w-full rounded-3xl px-5 py-7 text-center"
              style={{ background: "#fff", boxShadow: "0 14px 40px rgba(16,27,48,.09)", border: "1px solid #EDF0F4" }}>
              <div className="text-4xl mb-3">⏸️</div>
              <p className="text-lg font-bold" style={{ color: C.navy }}>{t.pausedTitle}</p>
              <p className="text-sm font-semibold mt-2" style={{ color: C.slate }}>{t.pausedMsg}</p>
              <div className="mt-5"><Btn onClick={() => { window.location.href = "https://alto-pro.com"; }}>{t.pausedBtn}</Btn></div>
            </div>
            <div className="mt-6"><LangToggle /></div>
          </div>
        ) : (<>
        {/* ?clean=1 (the sales deck's phone mockup) hides the demo banner so
            the prospect sees the app exactly as a client would. */}
        {!session && screen !== "onboard" && !/[?&]clean=1/.test(window.location.search) && (
          <div className="px-4 py-2 text-center" style={{ background: "#FEF5DC", borderBottom: "1.5px solid #F8B408" }}>
            <span className="text-xs font-bold" style={{ color: "#7A5A00" }}>{!DEMO_KEY ? t.demoCount(Math.min(demoUsed(), 6)) : t.demoBanner}</span>
          </div>
        )}
        {screen !== "onboard" && screen !== "trade" && screen !== "home" && screen !== "boot" && <Header title={titles[screen] || ""} back={() => setScreen(backMap[screen] || "home")} />}
        {screen === "boot" && (
          <div className="flex flex-col items-center justify-center flex-1" style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #EFF2F7 100%)", minHeight: "100vh" }}>
            <img src="/brand-logo.png" alt="ALTO Pro" style={{ maxWidth: 220, animation: "ttpPulse 1.6s ease-in-out infinite" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          </div>
        )}
        {screen === "onboard" && Onboard()}
        {screen === "settings" && Settings()}
        {screen === "trade" && TradePicker()}
        {screen === "home" && Home()}
        {screen === "calc" && (trade === "roofing" ? RoofCalc() : Calc())}
        {screen === "roofAddress" && RoofAddress()}
        {screen === "trace" && Trace()}
        {screen === "pickHouse" && PickHouse()}
        {screen === "voiceInvoice" && VoiceInvoice()}
        {screen === "fenceConfirm" && FenceConfirm()}
        {screen === "fenceDraw" && FenceDraw()}
        {screen === "pickCustomer" && PickCustomer()}
        {screen === "send" && SendScreen()}
        {screen === "jobs" && JobsList()}
        {screen === "jobDetail" && JobDetail()}
        {screen === "invoice" && Invoice()}
        {screen === "payments" && Payments()}
        {screen === "customers" && Customers()}
        {screen === "ai" && AI()}
        {screen === "leads" && Leads()}
        {screen === "webShare" && WebShare()}
        {withNav.includes(screen) && !deskShell && <BottomNav />}
        {instOpen && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 9997, background: "rgba(11,18,38,.92)", padding: 20 }} onClick={() => setInstOpen(false)}>
            <div className="rounded-3xl p-6" style={{ background: "#fff", maxWidth: 400, width: "100%", boxShadow: "0 24px 70px rgba(0,0,0,.45)" }} onClick={(e) => e.stopPropagation()}>
              <p className="text-xl font-extrabold text-center" style={{ color: C.navy }}>{t.instOverlayT}</p>
              <p className="rounded-xl px-3 py-2.5 text-sm font-bold mt-3" style={{ background: "#FEF5DC", color: C.navy, lineHeight: 1.5 }}>💬 {isIOSDev ? t.instWaIos : t.instWaAnd}</p>
              <div className="mt-3">
                {(isIOSDev ? t.installIosSteps : t.instAndSteps).map((step, i) => (
                  <p key={i} className="font-bold" style={{ color: C.navy, fontSize: 16.5, lineHeight: 1.5, padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>{step}</p>
                ))}
              </div>
              <div className="mt-5"><Btn onClick={() => setInstOpen(false)}>{t.instClose}</Btn></div>
            </div>
          </div>
        )}
        {viewPic && (
          <div className="fixed inset-0 flex items-center justify-center" style={{ background: "rgba(11,19,34,.92)", zIndex: 60 }} onClick={() => setViewPic(null)}>
            <img src={viewPic} alt="" style={{ maxWidth: "94%", maxHeight: "86%", borderRadius: 14 }} />
            <button className="absolute top-4 right-4 w-11 h-11 rounded-full text-xl font-bold" style={{ background: "rgba(255,255,255,.15)", color: "#fff", border: "none" }}>✕</button>
          </div>
        )}
        {toast && (
          <div className="absolute left-0 right-0 flex justify-center" style={deskShell ? { top: 66, pointerEvents: "none", zIndex: 40 } : { bottom: 80, pointerEvents: "none" }}>
            <span className="rounded-full px-5 py-2.5 font-bold text-sm text-white" style={{ background: C.navyDeep, boxShadow: "0 8px 20px rgba(0,0,0,.3)" }}>{toast}</span>
          </div>
        )}
        {demoCap && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 9998, background: "rgba(11,18,38,.92)", padding: 20 }}>
            <div className="rounded-3xl p-6 text-center" style={{ background: "#fff", maxWidth: 400, width: "100%", boxShadow: "0 24px 70px rgba(0,0,0,.45)" }}>
              <div style={{ fontSize: 44, lineHeight: 1 }}>🛰️</div>
              <p className="text-lg font-extrabold mt-3" style={{ color: C.navy }}>{t.capTitle}</p>
              <p className="text-sm font-semibold mt-2" style={{ color: C.slate, lineHeight: 1.65 }}>{t.capBody}</p>
              <a href={`https://wa.me/${SALES_WA}?text=${encodeURIComponent(t.capWAmsg)}`} target="_blank" rel="noopener noreferrer"
                className="block rounded-2xl py-3.5 mt-5 font-extrabold text-white" style={{ background: "#25D366", textDecoration: "none", fontSize: 15.5 }}>{t.capWA}</a>
              <a href="https://alto-pro.com" target="_blank" rel="noopener noreferrer"
                className="block mt-3 text-sm font-bold" style={{ color: C.slate, textDecoration: "underline" }}>{t.capPlans}</a>
              <button onClick={() => setDemoCap(false)} className="mt-4 text-xs font-bold" style={{ background: "none", border: "none", color: "#9AA3B2", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        )}
        {zoomPhoto && (
          <div onClick={() => setZoomPhoto(null)} className="absolute inset-0 flex items-center justify-center"
            style={{ zIndex: 9999, background: "rgba(8,12,20,.93)", padding: 16 }}>
            <img src={zoomPhoto} alt="" style={{ maxWidth: "100%", maxHeight: "84%", borderRadius: 14, boxShadow: "0 12px 44px rgba(0,0,0,.6)" }} />
            <button onClick={() => setZoomPhoto(null)} className="absolute flex items-center justify-center"
              style={{ top: 18, right: 18, width: 42, height: 42, borderRadius: 999, background: "rgba(255,255,255,.18)", color: "#fff", border: "none", fontSize: 20 }}>✕</button>
          </div>
        )}
        {driveDest && (
          <DriveMap dest={driveDest} lang={lang} mapsKey={mapsKey} onClose={() => setDriveDest(null)} />
        )}
        </>)}
      </div>
  );
  return (
    <div className="flex justify-center" style={{ background: deskShell ? C.bg : "#0B1226", height: "100%", overflow: "hidden" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,800&family=Inter:wght@400;500;600;700;800&display=swap');
        * { font-family: 'Inter', sans-serif; -webkit-tap-highlight-color: transparent; }
        input::placeholder { color: #A7AEBE; }
        @keyframes ttpPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.18); opacity: .65; } }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }`}</style>
      {deskShell && <SideNav />}
      {deskShell
        ? <div className="flex-1 flex justify-center" style={{ height: "100%", overflow: "hidden", minWidth: 0 }}>{appCol}</div>
        : appCol}
    </div>
  );
}
