// ==========================================
// CONFIGURACIÓN GLOBAL
// ==========================================
let currentFlight = {};
let map = null;
let historyMap = null;
let historyLines = [];
let historyMarkers = [];
let rutaActual = null;
let marcadorOrigen = null;
let marcadorDestino = null;
let marcadorAvion = null;
let intervaloAnimacion = null;
let indiceAnimacion = 0;
let puntosRuta = [];
const WEATHER_LOOKBACK_DAYS = 2;
let audioContext = null;
let activeOscillators = [];
let activeGainNodes = [];
let cabinInterval = null;
let noiseNodes = [];
let currentRouteGame = null;
let currentQuizGame = null;
let currentAirportGame = null;
let currentDistanceGame = null;
let plannerCalendarView = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let speedMultiplier = 1; // 1 = tiempo real, 2 = 2x velocidad, etc.
let tripExpenses = []; // Array de gastos del viaje
let expensesChart = null; // Instancia del gráfico
const weatherDetailCache = new Map();
const DELETE_TRIPS_PASSWORD = "BORRAR";
let deleteTripsMode = false;
const tripsPendingDelete = new Set();
const checklistIds = [
    "taskBaggageReady",
    "taskCheckinDone",
    "taskBoardingScan",
    "taskSeatAssigned",
    "taskGateAssigned",
    "taskGroupAssigned",
    "taskCheckedBag",
    "taskDocsReady"
];

const DEFAULT_PACKING_ITEMS = [
  { id: "packingDocsPassport", label: "Documentos y pasaporte", checked: false },
  { id: "packingChargers", label: "Cargadores y adaptadores", checked: false },
  { id: "packingMedications", label: "Medicamentos básicos", checked: false },
  { id: "packingClothing", label: "Ropa según clima (14°C)", checked: false },
  { id: "packingUmbrella", label: "Paraguas (probabilidad lluvia: 60%)", checked: false }
];

const COUNTRY_TRAVEL_ALERTS = {
  Italia: {
    title: "Seguimiento operativo en Italia",
    detail: "Puede haber huelgas sectoriales puntuales. Revisa el estado del vuelo 24h antes y vuelve a confirmar el aeropuerto.",
    severity: "warning",
    icon: "🚨"
  }
};

function getDefaultPackingChecklist() {
  return DEFAULT_PACKING_ITEMS.map(item => ({ ...item }));
}

function ensureFlightPackingList() {
  if (!currentFlight.packingChecklist || !Array.isArray(currentFlight.packingChecklist)) {
    currentFlight.packingChecklist = getDefaultPackingChecklist();
  }
  if (!currentFlight.conversionRate) {
    currentFlight.conversionRate = 1;
  }
  if (!currentFlight.conversionUpdatedAt) {
    currentFlight.conversionUpdatedAt = new Date().toISOString();
  }
}

function upsertPackingChecklistItem(id, label, checked = false) {
  ensureFlightPackingList();
  const existing = currentFlight.packingChecklist.find(item => item.id === id);

  if (existing) {
    existing.label = label;
    if (checked !== undefined) {
      existing.checked = existing.checked || checked;
    }
    return;
  }

  currentFlight.packingChecklist.push({ id, label, checked });
}

function renderPackingChecklist() {
  const container = document.getElementById("packingItemsList");
  if (!container) return;
  ensureFlightPackingList();

  if (!currentFlight.packingChecklist.length) {
    container.innerHTML = '<p class="packing-empty">No hay elementos en el checklist. Añade uno nuevo.</p>';
    return;
  }

  container.innerHTML = currentFlight.packingChecklist.map((item, index) => `
    <div class="packing-item">
      <label>
        <input type="checkbox" data-index="${index}" ${item.checked ? 'checked' : ''}>
        <span>${item.label}</span>
      </label>
      <button type="button" class="packing-remove-button" data-index="${index}" aria-label="Eliminar ítem">✕</button>
    </div>
  `).join("");
}

function convertCelsiusToFahrenheit(value) {
  return Math.round((value * 9) / 5 + 32);
}

function convertKmToMiles(km) {
  return Number((km * 0.621371).toFixed(2));
}

function isItalyFlight() {
  return [currentFlight.origin, currentFlight.destination].some(code => airportDatabase[code]?.pais === 'Italia');
}

function updateConversionSummary() {
  const container = document.getElementById("conversionSummary");
  if (!container) return;
  ensureFlightPackingList();

  const select = document.getElementById("destinationCountry");
  const selectedCountry = select ? select.value : "";
  
  // Si hay un país seleccionado, mostrar datos de ese país
  if (selectedCountry && countryDatabase[selectedCountry]) {
    const country = countryDatabase[selectedCountry];
    const temperatureC = parseFloat(country.temperatura) || 14;
    const temperatureF = convertCelsiusToFahrenheit(temperatureC);
    const distance = currentFlight.distanceKm || 100;
    const distanceLabel = `${distance} km`;
    const milesLabel = `${convertKmToMiles(distance)} millas`;
    
    // Conversión de moneda (EUR a la moneda del país)
    const exchangeRate = getExchangeRate('EUR', country.moneda);
    const eurAmount = 100;
    const convertedAmount = (eurAmount * exchangeRate).toFixed(2);
    
    container.innerHTML = `
      <div class="country-data">
        <p>📍 Viajando a <strong>${selectedCountry}</strong></p>
        <ul>
          <li><strong>Capital:</strong> ${country.capital}</li>
          <li><strong>Población:</strong> ${country.poblacion}</li>
          <li><strong>Idiomas:</strong> ${country.idiomas.join(', ')}</li>
          <li><strong>Zona horaria:</strong> ${country.zonaHoraria}</li>
        </ul>
        <div class="conversion-rates">
          <strong>💱 Conversión de Moneda:</strong>
          <ul>
            <li>1 EUR = ${exchangeRate.toFixed(3)} ${country.simbolo}</li>
            <li>${eurAmount} EUR = ${convertedAmount} ${country.simbolo}</li>
          </ul>
        </div>
        <div class="conversion-measurements">
          <strong>📐 Medidas:</strong>
          <ul>
            <li>Temperatura: ${temperatureC}°C = ${temperatureF}°F</li>
            <li>Distancia: ${distanceLabel} = ${milesLabel}</li>
          </ul>
        </div>
        <small class="conversion-note">Tasas actualizadas para ${selectedCountry} en tiempo real.</small>
      </div>
    `;
  } else {
    // Mostrar conversor de referencia si no hay país seleccionado
    const temperatureC = 14;
    const temperatureF = convertCelsiusToFahrenheit(temperatureC);
    const distance = currentFlight.distanceKm || 100;
    const distanceLabel = `${distance} km`;
    const milesLabel = `${convertKmToMiles(distance)} millas`;
    
    container.innerHTML = `
      <p>Selecciona un país para ver la conversión de moneda y otros datos locales.</p>
      <ul>
        <li>1 EUR = 1 EUR</li>
        <li>100 EUR = 100 EUR</li>
        <li>Temperatura: ${temperatureC}°C = ${temperatureF}°F</li>
        <li>Distancia: ${distanceLabel} = ${milesLabel}</li>
      </ul>
      <small class="conversion-note">Conversor de referencia para planificación de viajes.</small>
    `;
  }

  currentFlight.conversionUpdatedAt = new Date().toISOString();
}

function getExchangeRate(fromCurrency, toCurrency) {
  // Tasas de cambio aproximadas (actualizadas a 2026)
  const rates = {
    'EUR': {
      'EUR': 1,
      'USD': 1.08,
      'GBP': 0.86,
      'CHF': 0.96,
      'SEK': 11.35,
      'NOK': 11.52,
      'DKK': 7.46,
      'PLN': 4.30,
      'CZK': 24.50,
      'HUF': 400.00,
      'RON': 4.97,
      'TRY': 35.20,
      'CAD': 1.47,
      'MXN': 20.50,
      'COP': 4500.00,
      'PEN': 4.02,
      'BRL': 5.50,
      'CLP': 950.00,
      'ARS': 950.00,
      'UYU': 42.50,
      'PYG': 7800.00,
      'BOB': 7.45,
      'VES': 2420.00,
      'RUB': 105.50,
      'KRW': 1390.00,
      'JPY': 160.50
    }
  };
  
  const fromRates = rates[fromCurrency];
  if (!fromRates) return 1;
  
  const rate = fromRates[toCurrency];
  return rate || 1;
}

function getSeatRecommendation() {
  if (!currentFlight.aircraftName) {
    return 'Para A320: 17A recomendado';
  }

  if (currentFlight.aircraftName.includes('A320')) {
    return 'Para A320: 17A recomendado';
  }

  if (currentFlight.aircraftName.includes('Boeing 737')) {
    return 'Para Boeing 737: 14A recomendado';
  }

  return 'Prefieres ventana y ala. Recomendado: 17A cuando sea posible.';
}

function updateSeatRecommendation() {
  const seatText = document.getElementById('seatRecommendationText');
  if (!seatText) return;
  seatText.textContent = getSeatRecommendation();
}

function getPassportStamps() {
  const history = JSON.parse(localStorage.getItem('flights')) || [];
  return history.map(flight => ({
    id: `${flight.flight}-${flight.flightDate || flight.date}-${flight.origin}-${flight.destination}`,
    label: `${flight.origin} → ${flight.destination}`,
    date: flight.flightDate || flight.date,
    flight: flight.flight
  }));
}

function renderPassportStamps() {
  const container = document.getElementById('passportStampsList');
  const countLabel = document.getElementById('passportStampCount');
  if (!container || !countLabel) return;

  const stamps = getPassportStamps();
  countLabel.textContent = `${stamps.length} sello${stamps.length === 1 ? '' : 's'}`;

  if (!stamps.length) {
    container.innerHTML = '<p class="passport-empty">Aún no hay sellos. Guarda un vuelo para obtener tu pasaporte digital.</p>';
    return;
  }

  container.innerHTML = stamps.slice(-8).reverse().map(stamp => `
    <div class="passport-stamp" title="Vuelo ${stamp.flight}">
      <span class="passport-stamp-route">${stamp.label}</span>
      <span class="passport-stamp-date">${stamp.date}</span>
      <span class="passport-stamp-flight">${stamp.flight}</span>
    </div>
  `).join('');
}

function updatePassportStamps() {
  renderPassportStamps();
}

function togglePackingAddRow(show) {
  const row = document.getElementById("packingAddRow");
  if (!row) return;
  row.style.display = show ? "flex" : "none";
  if (show) {
    const input = document.getElementById("newPackingItemInput");
    if (input) input.focus();
  }
}

function addPackingChecklistItem(label) {
  if (!label || !label.trim()) return;
  ensureFlightPackingList();
  currentFlight.packingChecklist.push({
    id: `packingExtra${Date.now()}`,
    label: label.trim(),
    checked: false
  });
  renderPackingChecklist();
}

function togglePackingChecklistItem(index, checked) {
  if (!currentFlight.packingChecklist || !currentFlight.packingChecklist[index]) return;
  currentFlight.packingChecklist[index].checked = checked;
  renderPackingChecklist();
}

function removePackingChecklistItem(index) {
  if (!currentFlight.packingChecklist || !currentFlight.packingChecklist[index]) return;
  currentFlight.packingChecklist.splice(index, 1);
  renderPackingChecklist();
}

function handlePackingListClick(event) {
  const target = event.target;
  if (!target) return;

  if (target.matches('input[type="checkbox"]')) {
    const index = Number(target.dataset.index);
    togglePackingChecklistItem(index, target.checked);
    return;
  }

  if (target.matches('.packing-remove-button')) {
    const index = Number(target.dataset.index);
    removePackingChecklistItem(index);
  }
}

// ==========================================
// BASE DE DATOS DE AEROPUERTOS (COORDENADAS REALES)
// ==========================================
const airportDatabase = {
    // Europa
    MAD: { lat: 40.4719, lng: -3.5626, nombre: 'Madrid-Barajas', ciudad: 'Madrid', pais: 'España' },
    BCN: { lat: 41.2974, lng: 2.0833, nombre: 'Barcelona-El Prat', ciudad: 'Barcelona', pais: 'España' },
    PMI: { lat: 39.5517, lng: 2.7388, nombre: 'Palma de Mallorca', ciudad: 'Palma', pais: 'España' },
    AGP: { lat: 36.6749, lng: -4.4991, nombre: 'Málaga-Costa del Sol', ciudad: 'Málaga', pais: 'España' },
    SVQ: { lat: 37.4180, lng: -5.8931, nombre: 'Sevilla', ciudad: 'Sevilla', pais: 'España' },
    VLC: { lat: 39.4893, lng: -0.4816, nombre: 'Valencia', ciudad: 'Valencia', pais: 'España' },
    BIO: { lat: 43.3011, lng: -2.9106, nombre: 'Bilbao', ciudad: 'Bilbao', pais: 'España' },
    LIS: { lat: 38.7742, lng: -9.1342, nombre: 'Lisboa', ciudad: 'Lisboa', pais: 'Portugal' },
    OPO: { lat: 41.2420, lng: -8.6780, nombre: 'Oporto', ciudad: 'Oporto', pais: 'Portugal' },
    MXP: { lat: 45.6306, lng: 8.7281, nombre: 'Milán-Malpensa', ciudad: 'Milán', pais: 'Italia' },
    LIN: { lat: 45.4497, lng: 9.2783, nombre: 'Milán-Linate', ciudad: 'Milán', pais: 'Italia' },
    FCO: { lat: 41.8003, lng: 12.2389, nombre: 'Roma-Fiumicino', ciudad: 'Roma', pais: 'Italia' },
    CIA: { lat: 41.7994, lng: 12.5949, nombre: 'Roma-Ciampino', ciudad: 'Roma', pais: 'Italia' },
    TRN: { lat: 45.2008, lng: 7.6496, nombre: 'Turín-Caselle', ciudad: 'Turín', pais: 'Italia' },
    NAP: { lat: 40.8860, lng: 14.2908, nombre: 'Nápoles', ciudad: 'Nápoles', pais: 'Italia' },
    VCE: { lat: 45.5053, lng: 12.3519, nombre: 'Venecia Marco Polo', ciudad: 'Venecia', pais: 'Italia' },
    CDG: { lat: 49.0097, lng: 2.5479, nombre: 'París-Charles de Gaulle', ciudad: 'París', pais: 'Francia' },
    ORY: { lat: 48.7233, lng: 2.3794, nombre: 'París-Orly', ciudad: 'París', pais: 'Francia' },
    NCE: { lat: 43.6653, lng: 7.2150, nombre: 'Niza-Costa Azul', ciudad: 'Niza', pais: 'Francia' },
    MRS: { lat: 43.4393, lng: 5.2214, nombre: 'Marsella-Provenza', ciudad: 'Marsella', pais: 'Francia' },
    LHR: { lat: 51.4700, lng: -0.4543, nombre: 'Londres-Heathrow', ciudad: 'Londres', pais: 'Reino Unido' },
    STN: { lat: 51.8850, lng: 0.2350, nombre: 'Londres-Stansted', ciudad: 'Londres', pais: 'Reino Unido' },
    LGW: { lat: 51.1537, lng: -0.1821, nombre: 'Londres-Gatwick', ciudad: 'Londres', pais: 'Reino Unido' },
    MAN: { lat: 53.3650, lng: -2.2728, nombre: 'Manchester', ciudad: 'Manchester', pais: 'Reino Unido' },
    EDI: { lat: 55.9500, lng: -3.3725, nombre: 'Edimburgo', ciudad: 'Edimburgo', pais: 'Reino Unido' },
    BER: { lat: 52.3667, lng: 13.5033, nombre: 'Berlín-Brandeburgo', ciudad: 'Berlín', pais: 'Alemania' },
    FRA: { lat: 50.0379, lng: 8.5622, nombre: 'Fráncfort', ciudad: 'Fráncfort', pais: 'Alemania' },
    MUC: { lat: 48.3538, lng: 11.7861, nombre: 'Múnich', ciudad: 'Múnich', pais: 'Alemania' },
    HAM: { lat: 53.6304, lng: 9.9882, nombre: 'Hamburgo', ciudad: 'Hamburgo', pais: 'Alemania' },
    AMS: { lat: 52.3086, lng: 4.7639, nombre: 'Ámsterdam-Schiphol', ciudad: 'Ámsterdam', pais: 'Países Bajos' },
    BRU: { lat: 50.9010, lng: 4.4844, nombre: 'Bruselas', ciudad: 'Bruselas', pais: 'Bélgica' },
    ZRH: { lat: 47.4581, lng: 8.5555, nombre: 'Zúrich', ciudad: 'Zúrich', pais: 'Suiza' },
    GVA: { lat: 46.2381, lng: 6.1089, nombre: 'Ginebra', ciudad: 'Ginebra', pais: 'Suiza' },
    VIE: { lat: 48.1103, lng: 16.5697, nombre: 'Viena', ciudad: 'Viena', pais: 'Austria' },
    ATH: { lat: 37.9364, lng: 23.9475, nombre: 'Atenas', ciudad: 'Atenas', pais: 'Grecia' },
    DUB: { lat: 53.4213, lng: -6.2701, nombre: 'Dublín', ciudad: 'Dublín', pais: 'Irlanda' },
    CPH: { lat: 55.6181, lng: 12.6561, nombre: 'Copenhague', ciudad: 'Copenhague', pais: 'Dinamarca' },
    ARN: { lat: 59.6519, lng: 17.9186, nombre: 'Estocolmo-Arlanda', ciudad: 'Estocolmo', pais: 'Suecia' },
    OSL: { lat: 60.1976, lng: 11.1004, nombre: 'Oslo-Gardermoen', ciudad: 'Oslo', pais: 'Noruega' },
    HEL: { lat: 60.3172, lng: 24.9633, nombre: 'Helsinki', ciudad: 'Helsinki', pais: 'Finlandia' },
    WAW: { lat: 52.1657, lng: 20.9671, nombre: 'Varsovia Chopin', ciudad: 'Varsovia', pais: 'Polonia' },
    PRG: { lat: 50.1008, lng: 14.2600, nombre: 'Praga', ciudad: 'Praga', pais: 'Chequia' },
    BUD: { lat: 47.4369, lng: 19.2556, nombre: 'Budapest', ciudad: 'Budapest', pais: 'Hungría' },
    OTP: { lat: 44.5711, lng: 26.0850, nombre: 'Bucarest Henri Coandă', ciudad: 'Bucarest', pais: 'Rumanía' },
    IST: { lat: 41.2753, lng: 28.7519, nombre: 'Estambul', ciudad: 'Estambul', pais: 'Turquía' },

    // Norteamérica
    JFK: { lat: 40.6413, lng: -73.7781, nombre: 'Nueva York-JFK', ciudad: 'Nueva York', pais: 'EEUU' },
    LGA: { lat: 40.7769, lng: -73.8740, nombre: 'Nueva York-LaGuardia', ciudad: 'Nueva York', pais: 'EEUU' },
    EWR: { lat: 40.6895, lng: -74.1745, nombre: 'Newark', ciudad: 'Newark', pais: 'EEUU' },
    SFO: { lat: 37.6213, lng: -122.3790, nombre: 'San Francisco', ciudad: 'San Francisco', pais: 'EEUU' },
    LAX: { lat: 33.9416, lng: -118.4085, nombre: 'Los Ángeles', ciudad: 'Los Ángeles', pais: 'EEUU' },
    ORD: { lat: 41.9742, lng: -87.9073, nombre: 'Chicago O’Hare', ciudad: 'Chicago', pais: 'EEUU' },
    BOS: { lat: 42.3656, lng: -71.0096, nombre: 'Boston Logan', ciudad: 'Boston', pais: 'EEUU' },
    IAD: { lat: 38.9531, lng: -77.4565, nombre: 'Washington Dulles', ciudad: 'Washington', pais: 'EEUU' },
    SEA: { lat: 47.4502, lng: -122.3088, nombre: 'Seattle-Tacoma', ciudad: 'Seattle', pais: 'EEUU' },
    LAS: { lat: 36.0840, lng: -115.1537, nombre: 'Las Vegas Harry Reid', ciudad: 'Las Vegas', pais: 'EEUU' },
    ATL: { lat: 33.6407, lng: -84.4277, nombre: 'Atlanta Hartsfield-Jackson', ciudad: 'Atlanta', pais: 'EEUU' },
    DFW: { lat: 32.8998, lng: -97.0403, nombre: 'Dallas/Fort Worth', ciudad: 'Dallas', pais: 'EEUU' },
    MCO: { lat: 28.4312, lng: -81.3081, nombre: 'Orlando', ciudad: 'Orlando', pais: 'EEUU' },
    MIA: { lat: 25.7959, lng: -80.2870, nombre: 'Miami', ciudad: 'Miami', pais: 'EEUU' },
    YYZ: { lat: 43.6777, lng: -79.6248, nombre: 'Toronto Pearson', ciudad: 'Toronto', pais: 'Canadá' },
    YUL: { lat: 45.4706, lng: -73.7408, nombre: 'Montreal-Trudeau', ciudad: 'Montreal', pais: 'Canadá' },
    YVR: { lat: 49.1967, lng: -123.1815, nombre: 'Vancouver', ciudad: 'Vancouver', pais: 'Canadá' },
    MEX: { lat: 19.4361, lng: -99.0719, nombre: 'Ciudad de México', ciudad: 'Ciudad de México', pais: 'México' },
    CUN: { lat: 21.0365, lng: -86.8771, nombre: 'Cancún', ciudad: 'Cancún', pais: 'México' },
    GDL: { lat: 20.5218, lng: -103.3112, nombre: 'Guadalajara', ciudad: 'Guadalajara', pais: 'México' },
    MTY: { lat: 25.7785, lng: -100.1070, nombre: 'Monterrey', ciudad: 'Monterrey', pais: 'México' },

    // Latinoamérica y Caribe
    BOG: { lat: 4.7016, lng: -74.1469, nombre: 'Bogotá El Dorado', ciudad: 'Bogotá', pais: 'Colombia' },
    MDE: { lat: 6.1645, lng: -75.4231, nombre: 'Medellín José María Córdova', ciudad: 'Medellín', pais: 'Colombia' },
    LIM: { lat: -12.0219, lng: -77.1143, nombre: 'Lima Jorge Chávez', ciudad: 'Lima', pais: 'Perú' },
    CUZ: { lat: -13.5357, lng: -71.9388, nombre: 'Cusco', ciudad: 'Cusco', pais: 'Perú' },
    UIO: { lat: -0.1292, lng: -78.3575, nombre: 'Quito', ciudad: 'Quito', pais: 'Ecuador' },
    GYE: { lat: -2.1574, lng: -79.8836, nombre: 'Guayaquil', ciudad: 'Guayaquil', pais: 'Ecuador' },
    CCS: { lat: 10.6031, lng: -66.9912, nombre: 'Caracas Simón Bolívar', ciudad: 'Caracas', pais: 'Venezuela' },
    SCL: { lat: -33.3929, lng: -70.7858, nombre: 'Santiago de Chile', ciudad: 'Santiago', pais: 'Chile' },
    IPC: { lat: -27.1648, lng: -109.4212, nombre: 'Isla de Pascua', ciudad: 'Hanga Roa', pais: 'Chile' },
    EZE: { lat: -34.8222, lng: -58.5358, nombre: 'Buenos Aires Ezeiza', ciudad: 'Buenos Aires', pais: 'Argentina' },
    AEP: { lat: -34.5592, lng: -58.4156, nombre: 'Buenos Aires Aeroparque', ciudad: 'Buenos Aires', pais: 'Argentina' },
    COR: { lat: -31.3236, lng: -64.2080, nombre: 'Córdoba', ciudad: 'Córdoba', pais: 'Argentina' },
    MVD: { lat: -34.8384, lng: -56.0308, nombre: 'Montevideo Carrasco', ciudad: 'Montevideo', pais: 'Uruguay' },
    ASU: { lat: -25.2399, lng: -57.5191, nombre: 'Asunción Silvio Pettirossi', ciudad: 'Asunción', pais: 'Paraguay' },
    VVI: { lat: -17.6448, lng: -63.1354, nombre: 'Santa Cruz Viru Viru', ciudad: 'Santa Cruz', pais: 'Bolivia' },
    LPB: { lat: -16.5133, lng: -68.1923, nombre: 'La Paz El Alto', ciudad: 'La Paz', pais: 'Bolivia' },
    GRU: { lat: -23.4356, lng: -46.4731, nombre: 'São Paulo-Guarulhos', ciudad: 'São Paulo', pais: 'Brasil' },
    CGH: { lat: -23.6261, lng: -46.6566, nombre: 'São Paulo-Congonhas', ciudad: 'São Paulo', pais: 'Brasil' },
    GIG: { lat: -22.8090, lng: -43.2506, nombre: 'Río de Janeiro Galeão', ciudad: 'Río de Janeiro', pais: 'Brasil' },
    SDU: { lat: -22.9105, lng: -43.1631, nombre: 'Río de Janeiro Santos Dumont', ciudad: 'Río de Janeiro', pais: 'Brasil' },
    BSB: { lat: -15.8692, lng: -47.9208, nombre: 'Brasilia', ciudad: 'Brasilia', pais: 'Brasil' },
    SSA: { lat: -12.9086, lng: -38.3225, nombre: 'Salvador de Bahía', ciudad: 'Salvador', pais: 'Brasil' },
    REC: { lat: -8.1265, lng: -34.9236, nombre: 'Recife', ciudad: 'Recife', pais: 'Brasil' },
    PTY: { lat: 9.0714, lng: -79.3835, nombre: 'Panamá Tocumen', ciudad: 'Ciudad de Panamá', pais: 'Panamá' },
    SJO: { lat: 9.9939, lng: -84.2088, nombre: 'San José Juan Santamaría', ciudad: 'San José', pais: 'Costa Rica' },
    GUA: { lat: 14.5833, lng: -90.5275, nombre: 'Ciudad de Guatemala', ciudad: 'Ciudad de Guatemala', pais: 'Guatemala' },
    SAL: { lat: 13.4409, lng: -89.0557, nombre: 'San Salvador', ciudad: 'San Salvador', pais: 'El Salvador' },
    SAP: { lat: 15.4526, lng: -87.9236, nombre: 'San Pedro Sula', ciudad: 'San Pedro Sula', pais: 'Honduras' },
    MGA: { lat: 12.1415, lng: -86.1682, nombre: 'Managua', ciudad: 'Managua', pais: 'Nicaragua' },
    HAV: { lat: 22.9892, lng: -82.4091, nombre: 'La Habana', ciudad: 'La Habana', pais: 'Cuba' },
    PUJ: { lat: 18.5674, lng: -68.3634, nombre: 'Punta Cana', ciudad: 'Punta Cana', pais: 'República Dominicana' },
    SDQ: { lat: 18.4297, lng: -69.6689, nombre: 'Santo Domingo', ciudad: 'Santo Domingo', pais: 'República Dominicana' },
    SJU: { lat: 18.4394, lng: -66.0018, nombre: 'San Juan', ciudad: 'San Juan', pais: 'Puerto Rico' },

    // África
    CAI: { lat: 30.1120, lng: 31.3999, nombre: 'El Cairo', ciudad: 'El Cairo', pais: 'Egipto' },
    JNB: { lat: -26.1337, lng: 28.2420, nombre: 'Johannesburgo O.R. Tambo', ciudad: 'Johannesburgo', pais: 'Sudáfrica' },
    CPT: { lat: -33.9696, lng: 18.5976, nombre: 'Ciudad del Cabo', ciudad: 'Ciudad del Cabo', pais: 'Sudáfrica' },
    NBO: { lat: -1.3192, lng: 36.9275, nombre: 'Nairobi Jomo Kenyatta', ciudad: 'Nairobi', pais: 'Kenia' },
    CMN: { lat: 33.3675, lng: -7.5899, nombre: 'Casablanca Mohammed V', ciudad: 'Casablanca', pais: 'Marruecos' },
    LOS: { lat: 6.5774, lng: 3.3212, nombre: 'Lagos Murtala Muhammed', ciudad: 'Lagos', pais: 'Nigeria' },
    ACC: { lat: 5.6052, lng: -0.1668, nombre: 'Accra Kotoka', ciudad: 'Accra', pais: 'Ghana' },
    DAR: { lat: -6.8781, lng: 39.2026, nombre: 'Dar es Salaam', ciudad: 'Dar es Salaam', pais: 'Tanzania' },
    TUN: { lat: 36.8510, lng: 10.2270, nombre: 'Túnez-Cartago', ciudad: 'Túnez', pais: 'Túnez' },
    KGL: { lat: -1.9686, lng: 30.1394, nombre: 'Kigali', ciudad: 'Kigali', pais: 'Ruanda' }
};

const airportSearchCache = new Map();

async function resolveAirportByCode(code) {
    if (!code || typeof code !== 'string') return null;
    const normalized = code.trim().toUpperCase();
    if (airportDatabase[normalized]) {
        return airportDatabase[normalized];
    }
    if (airportSearchCache.has(normalized)) {
        return airportSearchCache.get(normalized);
    }

    let resolved = await lookupAirportWithOpenMeteo(normalized);
    if (!resolved) {
        resolved = await lookupAirportWithNominatim(normalized);
    }

    if (resolved) {
        airportDatabase[normalized] = resolved;
        airportSearchCache.set(normalized, resolved);
        return resolved;
    }

    airportSearchCache.set(normalized, null);
    return null;
}

async function lookupAirportWithOpenMeteo(code) {
    try {
        const query = encodeURIComponent(`${code} airport`);
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${query}&count=5&language=es`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = await response.json();

        if (!Array.isArray(data.results) || !data.results.length) return null;
        const airport = data.results.find(item => /airport|aeropuerto|aeródromo|aerodrome/i.test(item.name + ' ' + (item.type || '')))
            || data.results[0];

        return {
            lat: Number(airport.latitude),
            lng: Number(airport.longitude),
            nombre: airport.name || code,
            ciudad: airport.admin1 || airport.country || '',
            pais: airport.country || 'Desconocido'
        };
    } catch (error) {
        console.warn('OpenMeteo airport lookup failed:', error);
        return null;
    }
}

async function lookupAirportWithNominatim(code) {
    try {
        const query = encodeURIComponent(`${code} airport`);
        const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=3&addressdetails=1`;
        const response = await fetch(url, {
            headers: { 'Accept-Language': 'es' }
        });
        if (!response.ok) return null;
        const results = await response.json();
        if (!Array.isArray(results) || !results.length) return null;

        const match = results.find(item => /aerodrome|airport|aeropuerto|aeródromo/i.test(item.display_name + ' ' + (item.type || '') + ' ' + (item.class || '')))
            || results[0];

        const address = match.address || {};
        return {
            lat: Number(match.lat),
            lng: Number(match.lon),
            nombre: match.display_name.split(',')[0] || code,
            ciudad: address.city || address.town || address.village || address.state || '',
            pais: address.country || 'Desconocido'
        };
    } catch (error) {
        console.warn('Nominatim airport lookup failed:', error);
        return null;
    }
}

async function ensureAirportData(flight) {
    if (!flight || !flight.origin || !flight.destination) return false;
    const originCode = flight.origin.trim().toUpperCase();
    const destinationCode = flight.destination.trim().toUpperCase();
    let originResolved = airportDatabase[originCode];
    let destinationResolved = airportDatabase[destinationCode];

    if (!originResolved) {
        originResolved = await resolveAirportByCode(originCode);
    }
    if (!destinationResolved) {
        destinationResolved = await resolveAirportByCode(destinationCode);
    }

    if (originResolved && destinationResolved) {
        flight.distanceKm = Math.round(calcularDistancia(
            originResolved.lat,
            originResolved.lng,
            destinationResolved.lat,
            destinationResolved.lng
        ));
        return true;
    }
    return false;
}

// ==========================================
// BASE DE DATOS DE AEROLÍNEAS
// ==========================================
const airlineDatabase = {
    'FR': { nombre: 'Ryanair', avion: 'Boeing 737-800', codigo: 'RYR' },
    'IB': { nombre: 'Iberia', avion: 'Airbus A320', codigo: 'IBE' },
    'UX': { nombre: 'Air Europa', avion: 'Boeing 737-800', codigo: 'AEA' },
    'AZ': { nombre: 'ITA Airways', avion: 'Airbus A320', codigo: 'ITY' },
    'VY': { nombre: 'Vueling', avion: 'Airbus A320', codigo: 'VLG' },
    'U2': { nombre: 'EasyJet', avion: 'Airbus A320', codigo: 'EZY' },
    'AA': { nombre: 'American Airlines', avion: 'Boeing 777', codigo: 'AAL' },
    'DL': { nombre: 'Delta Airlines', avion: 'Airbus A330', codigo: 'DAL' },
    'BA': { nombre: 'British Airways', avion: 'Airbus A380', codigo: 'BAW' },
    'AF': { nombre: 'Air France', avion: 'Airbus A350', codigo: 'AFR' },
    'LH': { nombre: 'Lufthansa', avion: 'Boeing 747-8', codigo: 'DLH' }
};

// ==========================================
// BASE DE DATOS DE PAÍSES
// ==========================================
const countryDatabase = {
    // Europa
    'España': { codigo: 'ES', moneda: 'EUR', simbolo: '€', zonaHoraria: 'CET', idiomas: ['Español', 'Catalán', 'Gallego', 'Vasco'], capital: 'Madrid', poblacion: '47.6M', temperatura: '14°C' },
    'Portugal': { codigo: 'PT', moneda: 'EUR', simbolo: '€', zonaHoraria: 'WET', idiomas: ['Portugués'], capital: 'Lisboa', poblacion: '10.4M', temperatura: '12°C' },
    'Italia': { codigo: 'IT', moneda: 'EUR', simbolo: '€', zonaHoraria: 'CET', idiomas: ['Italiano'], capital: 'Roma', poblacion: '58.9M', temperatura: '15°C' },
    'Francia': { codigo: 'FR', moneda: 'EUR', simbolo: '€', zonaHoraria: 'CET', idiomas: ['Francés'], capital: 'París', poblacion: '67.7M', temperatura: '11°C' },
    'Reino Unido': { codigo: 'GB', moneda: 'GBP', simbolo: '£', zonaHoraria: 'GMT', idiomas: ['Inglés'], capital: 'Londres', poblacion: '67.2M', temperatura: '9°C' },
    'Alemania': { codigo: 'DE', moneda: 'EUR', simbolo: '€', zonaHoraria: 'CET', idiomas: ['Alemán'], capital: 'Berlín', poblacion: '83.4M', temperatura: '10°C' },
    'Países Bajos': { codigo: 'NL', moneda: 'EUR', simbolo: '€', zonaHoraria: 'CET', idiomas: ['Neerlandés'], capital: 'Ámsterdam', poblacion: '17.5M', temperatura: '10°C' },
    'Bélgica': { codigo: 'BE', moneda: 'EUR', simbolo: '€', zonaHoraria: 'CET', idiomas: ['Flamenco', 'Francés', 'Alemán'], capital: 'Bruselas', poblacion: '11.6M', temperatura: '10°C' },
    'Suiza': { codigo: 'CH', moneda: 'CHF', simbolo: 'CHF', zonaHoraria: 'CET', idiomas: ['Alemán', 'Francés', 'Italiano', 'Romanche'], capital: 'Berna', poblacion: '8.7M', temperatura: '8°C' },
    'Austria': { codigo: 'AT', moneda: 'EUR', simbolo: '€', zonaHoraria: 'CET', idiomas: ['Alemán'], capital: 'Viena', poblacion: '9.0M', temperatura: '9°C' },
    'Grecia': { codigo: 'GR', moneda: 'EUR', simbolo: '€', zonaHoraria: 'EET', idiomas: ['Griego'], capital: 'Atenas', poblacion: '10.7M', temperatura: '16°C' },
    'Irlanda': { codigo: 'IE', moneda: 'EUR', simbolo: '€', zonaHoraria: 'GMT', idiomas: ['Inglés', 'Irlandés'], capital: 'Dublín', poblacion: '5.0M', temperatura: '9°C' },
    'Dinamarca': { codigo: 'DK', moneda: 'DKK', simbolo: 'kr', zonaHoraria: 'CET', idiomas: ['Danés'], capital: 'Copenhague', poblacion: '5.9M', temperatura: '8°C' },
    'Suecia': { codigo: 'SE', moneda: 'SEK', simbolo: 'kr', zonaHoraria: 'CET', idiomas: ['Sueco'], capital: 'Estocolmo', poblacion: '10.5M', temperatura: '7°C' },
    'Noruega': { codigo: 'NO', moneda: 'NOK', simbolo: 'kr', zonaHoraria: 'CET', idiomas: ['Noruego'], capital: 'Oslo', poblacion: '5.4M', temperatura: '6°C' },
    'Finlandia': { codigo: 'FI', moneda: 'EUR', simbolo: '€', zonaHoraria: 'EET', idiomas: ['Finlandés', 'Sueco'], capital: 'Helsinki', poblacion: '5.5M', temperatura: '5°C' },
    'Polonia': { codigo: 'PL', moneda: 'PLN', simbolo: 'zł', zonaHoraria: 'CET', idiomas: ['Polaco'], capital: 'Varsovia', poblacion: '37.7M', temperatura: '8°C' },
    'Chequia': { codigo: 'CZ', moneda: 'CZK', simbolo: 'Kč', zonaHoraria: 'CET', idiomas: ['Checo'], capital: 'Praga', poblacion: '10.5M', temperatura: '9°C' },
    'Hungría': { codigo: 'HU', moneda: 'HUF', simbolo: 'Ft', zonaHoraria: 'CET', idiomas: ['Húngaro'], capital: 'Budapest', poblacion: '9.7M', temperatura: '10°C' },
    'Rumanía': { codigo: 'RO', moneda: 'RON', simbolo: 'lei', zonaHoraria: 'EET', idiomas: ['Rumano'], capital: 'Bucarest', poblacion: '19.0M', temperatura: '11°C' },
    'Turquía': { codigo: 'TR', moneda: 'TRY', simbolo: '₺', zonaHoraria: 'EET', idiomas: ['Turco'], capital: 'Ankara', poblacion: '85.3M', temperatura: '13°C' },
    
    // Norteamérica
    'EEUU': { codigo: 'US', moneda: 'USD', simbolo: '$', zonaHoraria: 'EST', idiomas: ['Inglés'], capital: 'Washington D.C.', poblacion: '331M', temperatura: '12°C' },
    'Canadá': { codigo: 'CA', moneda: 'CAD', simbolo: '$', zonaHoraria: 'EST', idiomas: ['Inglés', 'Francés'], capital: 'Ottawa', poblacion: '38.2M', temperatura: '6°C' },
    'México': { codigo: 'MX', moneda: 'MXN', simbolo: '$', zonaHoraria: 'CST', idiomas: ['Español'], capital: 'Ciudad de México', poblacion: '128.9M', temperatura: '16°C' },
    
    // Sudamérica
    'Colombia': { codigo: 'CO', moneda: 'COP', simbolo: '$', zonaHoraria: 'COT', idiomas: ['Español'], capital: 'Bogotá', poblacion: '51.9M', temperatura: '14°C' },
    'Perú': { codigo: 'PE', moneda: 'PEN', simbolo: 'S/', zonaHoraria: 'PET', idiomas: ['Español', 'Quechua', 'Aymara'], capital: 'Lima', poblacion: '34.3M', temperatura: '16°C' },
    'Ecuador': { codigo: 'EC', moneda: 'USD', simbolo: '$', zonaHoraria: 'ECT', idiomas: ['Español'], capital: 'Quito', poblacion: '18.0M', temperatura: '15°C' },
    'Venezuela': { codigo: 'VE', moneda: 'VES', simbolo: 'Bs', zonaHoraria: 'VET', idiomas: ['Español'], capital: 'Caracas', poblacion: '28.3M', temperatura: '17°C' },
    'Chile': { codigo: 'CL', moneda: 'CLP', simbolo: '$', zonaHoraria: 'CLT', idiomas: ['Español'], capital: 'Santiago', poblacion: '19.1M', temperatura: '14°C' },
    'Argentina': { codigo: 'AR', moneda: 'ARS', simbolo: '$', zonaHoraria: 'ART', idiomas: ['Español'], capital: 'Buenos Aires', poblacion: '46.2M', temperatura: '17°C' },
    'Uruguay': { codigo: 'UY', moneda: 'UYU', simbolo: '$', zonaHoraria: 'ART', idiomas: ['Español'], capital: 'Montevideo', poblacion: '3.4M', temperatura: '15°C' },
    'Paraguay': { codigo: 'PY', moneda: 'PYG', simbolo: '₲', zonaHoraria: 'PYT', idiomas: ['Español', 'Guaraní'], capital: 'Asunción', poblacion: '6.8M', temperatura: '18°C' },
    'Bolivia': { codigo: 'BO', moneda: 'BOB', simbolo: 'Bs.', zonaHoraria: 'BOT', idiomas: ['Español', 'Quechua'], capital: 'La Paz', poblacion: '12.2M', temperatura: '12°C' },
    'Brasil': { codigo: 'BR', moneda: 'BRL', simbolo: 'R$', zonaHoraria: 'BRT', idiomas: ['Portugués'], capital: 'Brasilia', poblacion: '215.3M', temperatura: '18°C' },
    
    // Centroamérica y Caribe
    'Panamá': { codigo: 'PA', moneda: 'PAB', simbolo: 'B/.', zonaHoraria: 'EST', idiomas: ['Español', 'Inglés'], capital: 'Ciudad de Panamá', poblacion: '4.4M', temperatura: '18°C' },
    'Costa Rica': { codigo: 'CR', moneda: 'CRC', simbolo: '₡', zonaHoraria: 'CST', idiomas: ['Español'], capital: 'San José', poblacion: '5.2M', temperatura: '18°C' },
    'Guatemala': { codigo: 'GT', moneda: 'GTQ', simbolo: 'Q', zonaHoraria: 'CST', idiomas: ['Español'], capital: 'Ciudad de Guatemala', poblacion: '18.1M', temperatura: '16°C' },
    'El Salvador': { codigo: 'SV', moneda: 'SVC', simbolo: '₡', zonaHoraria: 'CST', idiomas: ['Español'], capital: 'San Salvador', poblacion: '6.3M', temperatura: '17°C' },
    'Honduras': { codigo: 'HN', moneda: 'HNL', simbolo: 'L', zonaHoraria: 'CST', idiomas: ['Español'], capital: 'Tegucigalpa', poblacion: '10.1M', temperatura: '16°C' },
    'Nicaragua': { codigo: 'NI', moneda: 'NIO', simbolo: 'C$', zonaHoraria: 'CST', idiomas: ['Español'], capital: 'Managua', poblacion: '7.1M', temperatura: '17°C' },
    'Cuba': { codigo: 'CU', moneda: 'CUP', simbolo: '₱', zonaHoraria: 'EST', idiomas: ['Español'], capital: 'La Habana', poblacion: '11.2M', temperatura: '17°C' },
    'República Dominicana': { codigo: 'DO', moneda: 'DOP', simbolo: 'RD$', zonaHoraria: 'EST', idiomas: ['Español'], capital: 'Santo Domingo', poblacion: '10.8M', temperatura: '17°C' },
    'Puerto Rico': { codigo: 'PR', moneda: 'USD', simbolo: '$', zonaHoraria: 'EST', idiomas: ['Español', 'Inglés'], capital: 'San Juan', poblacion: '3.2M', temperatura: '17°C' }
};

const aviationQuizQuestions = [
    {
        question: "¿Qué significa IATA en aviación comercial?",
        options: ["Asociación Internacional de Transporte Aéreo", "Autoridad Internacional de Tráfico Aéreo", "Agencia Iberoamericana de Terminales Aéreas"],
        correct: 0
    },
    {
        question: "¿Qué código IATA corresponde al aeropuerto de Madrid-Barajas?",
        options: ["BCN", "MAD", "MXP"],
        correct: 1
    },
    {
        question: "¿Qué parte del avión ayuda a generar sustentación?",
        options: ["Las alas", "El tren de aterrizaje", "La cabina"],
        correct: 0
    },
    {
        question: "¿Qué fase ocurre antes del despegue?",
        options: ["Taxi", "Crucero", "Aproximación final"],
        correct: 0
    }
];

// ==========================================
// INICIALIZACIÓN DEL MAPA LEAFLET
// ==========================================
function inicializarMapa() {
    map = L.map('leafletMap').setView([43, 2], 5);
    
    // Capa base estilo Google Maps
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
        className: 'map-tiles'
    }).addTo(map);
    
    // Icono personalizado para el avión
    const iconoAvion = L.divIcon({
        html: '✈',
        className: 'plane-icon',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    
    console.log('✅ Mapa inicializado correctamente');
}

// ==========================================
// OCR - PROCESAR TARJETA DE EMBARQUE
// ==========================================
async function processBoardingPassFile(file) {
    if (!file) return;
    
    // Mostrar estado de carga
    mostrarEstadoCarga(true);
    setText("flight", "🔍 Analizando billete...");
    setText("route", "Leyendo QR y OCR...");
    
    try {
        const scan = await readTravelDocument(file);
        const text = normalizeScanText(scan.text);
        console.log('📝 Texto reconocido:', text);
        console.log('🔳 Código detectado:', scan.qrRaw || 'Sin código');

        currentFlight = parseTravelDocument(text, scan.qrRaw);

        if (currentFlight.transportType === "train") {
            registerUploadedJourney(currentFlight);
        } else {
            registerUploadedBoardingPass(currentFlight);
        }
        
        // Actualizar interfaz
        actualizarPantalla();
        mostrarEstadoCarga(false);
        updateDetailedWeatherWidgets();
        
        playScanSuccessTone();
        mostrarNotificacion(currentFlight.transportType === "train" ? '✅ Billete de tren procesado' : '✅ Tarjeta de embarque procesada', 'success');
        
    } catch (error) {
        console.error("❌ Error OCR:", error);
        mostrarEstadoCarga(false);
        setText("flight", "❌ Error al procesar");
        mostrarNotificacion('Error al leer el billete. Prueba con más luz y el documento bien enfocado.', 'error');
    }
}

const imageInput = document.getElementById("imageInput");
if (imageInput) {
    imageInput.addEventListener("change", function(e) {
        processBoardingPassFile(e.target.files[0]);
    });
}

const cameraInput = document.getElementById("cameraInput");
if (cameraInput) {
    cameraInput.addEventListener("change", function(e) {
        processBoardingPassFile(e.target.files[0]);
    });
}

async function readTravelDocument(file) {
    const [barcodeResult, ocrText] = await Promise.all([
        scanBarcodeFromImage(file),
        recognizeDocumentText(file)
    ]);

    return {
        qrRaw: barcodeResult?.rawValue || "",
        barcodeFormat: barcodeResult?.format || "",
        text: [barcodeResult?.rawValue || "", ocrText].filter(Boolean).join("\n")
    };
}

async function scanBarcodeFromImage(file) {
    if (!("BarcodeDetector" in window)) return null;

    try {
        const detector = new BarcodeDetector({
            formats: ["qr_code", "pdf417", "aztec", "data_matrix"]
        });
        const bitmap = await createImageBitmap(file);
        const codes = await detector.detect(bitmap);
        bitmap.close?.();
        return codes[0] || null;
    } catch (error) {
        console.warn("BarcodeDetector no pudo leer el código:", error);
        return null;
    }
}

async function recognizeDocumentText(file) {
    const enhanced = await createEnhancedOcrImage(file).catch(() => null);
    const sources = enhanced ? [file, enhanced] : [file];
    const texts = [];

    for (let index = 0; index < sources.length; index += 1) {
        const result = await Tesseract.recognize(sources[index], "eng+spa+ita+fra", {
            tessedit_pageseg_mode: "6",
            preserve_interword_spaces: "1",
            logger: info => {
                if (info.status === 'recognizing text') {
                    const progress = Math.round(info.progress * 100);
                    const pass = sources.length > 1 ? ` ${index + 1}/${sources.length}` : "";
                    setText("flight", `📊 Reconociendo texto${pass} (${progress}%)`);
                }
            }
        });
        texts.push(result.data.text || "");
    }

    return mergeScanTexts(texts);
}

async function createEnhancedOcrImage(file) {
    const bitmap = await createImageBitmap(file);
    const maxWidth = 1800;
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
        const contrasted = gray > 150 ? 255 : gray < 95 ? 0 : Math.min(255, Math.max(0, (gray - 128) * 1.8 + 128));
        data[i] = contrasted;
        data[i + 1] = contrasted;
        data[i + 2] = contrasted;
    }
    ctx.putImageData(imageData, 0, 0);

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("No se pudo preparar imagen OCR")), "image/png", 1);
    });
}

function mergeScanTexts(texts) {
    const seen = new Set();
    return texts
        .join("\n")
        .split(/\n+/)
        .map(line => line.trim())
        .filter(line => {
            const key = line.toUpperCase().replace(/\s+/g, " ");
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .join("\n");
}

function normalizeScanText(text) {
    return (text || "")
        .replace(/[|]/g, "I")
        .replace(/[“”]/g, '"')
        .replace(/[’]/g, "'")
        .replace(/\s+/g, " ")
        .toUpperCase()
        .trim();
}

function parseTravelDocument(text, qrRaw = "") {
    return isTrainDocument(text, qrRaw) ? createTrainJourney(text, qrRaw) : createFlightJourney(text, qrRaw);
}

function isTrainDocument(text, qrRaw = "") {
    const combined = `${text} ${qrRaw}`.toUpperCase();
    return /\b(RENFE|AVLO|OUIGO|ITALO|TRENITALIA|SNCF|TRAIN|TRENO|TREIN|TREN|RAIL|VOITURE|COACH|VAGON|VAGONE|CARROZZA|ANDEN|PLATFORM|BINARIO)\b/.test(combined);
}

function createFlightJourney(text, qrRaw = "") {
    const routeData = extraerDatosRuta(text);
    const extractedDate = extraerFecha(text);

    return {
        transportType: "flight",
        flight: extraerNumeroVuelo(text),
        route: routeData.route,
        origin: routeData.origin,
        destination: routeData.destination,
        seat: extraerAsiento(text),
        gate: extraerPuerta(text),
        terminal: extraerTerminal(text),
        flightClass: extraerClase(text),
        baggage: extraerEquipaje(text),
        boardingGroup: extraerGrupo(text),
        departureTime: extraerHoraVuelo(text),
        boardingTime: extraerHoraEmbarque(text),
        date: extractedDate,
        flightDate: resolverFechaVueloISO(extractedDate),
        rawText: text,
        qrRaw
    };
}

function createTrainJourney(text, qrRaw = "") {
    const routeData = extraerDatosRutaTren(text);
    const times = extraerHorasTren(text);
    const trainNumber = extraerNumeroTren(text);
    const trainClass = extraerClaseTren(text);

    return {
        transportType: "train",
        flight: trainNumber,
        trainNumber,
        route: routeData.route,
        origin: routeData.origin,
        destination: routeData.destination,
        seat: extraerAsientoTren(text),
        coach: extraerVagonTren(text),
        gate: extraerAndenTren(text),
        terminal: "---",
        flightClass: trainClass,
        trainClass,
        operatorName: extraerOperadoraTren(text),
        departureTime: times.departure,
        arrivalTime: times.arrival,
        durationText: extraerDuracionTren(text, times),
        date: extraerFecha(text),
        flightDate: resolverFechaVueloISO(extraerFecha(text)),
        rawText: text,
        qrRaw
    };
}

function registerUploadedJourney(journey) {
    const journeys = JSON.parse(localStorage.getItem("uploadedJourneys") || "[]");
    journeys.unshift({
        ...journey,
        uploadedAt: new Date().toISOString()
    });
    localStorage.setItem("uploadedJourneys", JSON.stringify(journeys.slice(0, 30)));
}

// ==========================================
// FUNCIONES DE EXTRACCIÓN OCR MEJORADAS
// ==========================================
function extraerNumeroVuelo(text) {
    // Buscar patrones como: FR2481, IB3245, UX1065, VY8432
    const patrones = [
        /\b(?:FLIGHT|VUELO|VOLO|VOL)\s*[:#\-]?\s*([A-Z0-9]{2,3})\s*([0-9OISB]{2,5})\b/i,
        /\b([A-Z0-9]{2})\s*([0-9OISB]{3,5})\b/g,
        /\b([A-Z]{3})\s*([0-9OISB]{2,4})\b/g
    ];
    
    for (let patron of patrones) {
        const match = patron.exec(text);
        if (match) {
            return normalizeFlightNumber(`${match[1]}${match[2]}`);
        }
    }
    
    return "---";
}

function extraerAsiento(text) {
    // Buscar patrones: 23A, 14F, SEAT 12C
    const patrones = [
        /\b(?:SEAT|ASIENTO|SITZ|POSTO|PLACE)\s*[:#\-]?\s*([0-9OISB]{1,3}\s?[A-Z])\b/i,
        /\b([0-9OISB]{1,3}\s?[A-F])\b/
    ];
    
    for (let patron of patrones) {
        const match = text.match(patron);
        if (match) return normalizeSeatCode(match[1]);
    }
    
    return "---";
}

function extraerPuerta(text) {
    const patrones = [
        /\bGATE\s*[:\-]?\s*([A-Z]?\d{1,3})\b/i,
        /\bPUERTA\s*[:\-]?\s*([A-Z]?\d{1,3})\b/i,
        /\bEMBARQUE\s*[:\-]?\s*([A-Z]?\d{1,3})\b/i
    ];

    for (let patron of patrones) {
        const match = text.match(patron);
        if (match) return match[1].toUpperCase();
    }

    return "---";
}

function extraerTerminal(text) {
    const patrones = [
        /\bTERMINAL\s*[:\-]?\s*(T\d|[A-Z]\d?)\b/i,
        /\bTERMINAL\s*([0-9]{1,2})\b/i,
        /\bTPA\s*[:\-]?\s*(T\d)\b/i
    ];

    for (const patron of patrones) {
        const match = text.match(patron);
        if (match) return match[1].toUpperCase();
    }

    return "---";
}

function extraerClase(text) {
    const patterns = [
        /\bBUSINESS\b/i,
        /\bPREMIUM ECONOMY\b/i,
        /\bFIRST CLASS\b/i,
        /\bC\/F\b/i,
        /\bF\/C\b/i,
        /\bCLASE\s*[:\-]?\s*(ECONOMY|TURISTA|BUSINESS|PRIMERA|PREMIUM)\b/i,
        /\bECONOMY\b/i,
        /\bTURISTA\b/i,
        /\bPRIMERA\b/i
    ];

    const resultado = patterns.reduce((value, pattern) => {
        const match = text.match(pattern);
        return match ? match[0] : value;
    }, null);

    if (!resultado) return "Turista";
    if (/BUSINESS|PREMIUM|FIRST|PRIMERA/i.test(resultado)) return /BUSINESS/i.test(resultado) ? "Business" : /FIRST|PRIMERA/i.test(resultado) ? "Primera" : /PREMIUM/i.test(resultado) ? "Premium Economy" : "Business";
    if (/ECONOMY|TURISTA/i.test(resultado)) return "Turista";
    return resultado;
}

function extraerEquipaje(text) {
    const patterns = [
        /\b(\d{1,2}\s?KG|\d{1,2}KG|\d{1,2}\s?KGS|\d{1,2}KGS)\b/i,
        /\b(\d{1,2}\s?PC|\d{1,2}\s?PCE|\d{1,2}PCE)\b/i,
        /\bBAGGAGE\s*[:\-]?\s*([A-Z0-9\s]+)\b/i,
        /\bEQUIPAJE\s*[:\-]?\s*([A-Z0-9\s]+)\b/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1] ? match[1].trim() : match[0].trim();
        }
    }

    return "1 PC incluido";
}

function extraerGrupo(text) {
    const patrones = [
        /\bGROUP\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i,
        /\bGRUPO\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i,
        /\bZONE\s*[:\-]?\s*([A-Z0-9]{1,3})\b/i
    ];

    for (let patron of patrones) {
        const match = text.match(patron);
        if (match) return match[1].toUpperCase();
    }

    return "---";
}

function extraerHoraVuelo(text) {
    const directMatch = text.match(/\b(?:DEP|DEPARTURE|SALIDA|FLIGHT TIME)\s*[:\-]?\s*([0-2]?\d[:.][0-5]\d)\b/i);
    if (directMatch?.[1]) {
        return directMatch[1].replace(".", ":").padStart(5, "0");
    }

    const genericTimes = Array.from(text.matchAll(/\b([0-2]?\d[:.][0-5]\d)\b/g)).map(match => match[1]);
    const firstUseful = genericTimes.find(value => !value.startsWith("00"));
    return firstUseful ? firstUseful.replace(".", ":").padStart(5, "0") : "";
}

function extraerHoraEmbarque(text) {
    const patterns = [
        /\b(?:BOARDING|EMBARQUE)\s*[:\-]?\s*([0-2]?\d[:.][0-5]\d)\b/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
            return match[1].replace(".", ":").padStart(5, "0");
        }
    }

    return "";
}

function extraerFecha(text) {
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", 
                   "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    
    // Buscar formato: 15MAR, 23 JUN, 07NOV
    for (let month of months) {
        const regex = new RegExp(`(\\d{1,2})\\s*${month}`, 'i');
        const match = text.match(regex);
        if (match) {
            const dia = match[1].padStart(2, '0');
            return `${dia} ${month}`;
        }
    }
    
    // Buscar formato: 2024-03-15, 15/03/2024
    const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;
    const dateMatch = text.match(dateRegex);
    if (dateMatch) return dateMatch[1];
    
    return new Date().toLocaleDateString();
}

function resolverFechaVueloISO(dateText) {
    if (!dateText || dateText === "---") {
        return formatearFechaISO(new Date());
    }

    const normalized = dateText.trim().toUpperCase();
    const monthMap = {
        JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
        JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
    };

    const monthMatch = normalized.match(/^(\d{1,2})\s*([A-Z]{3})$/);
    if (monthMatch && monthMap[monthMatch[2]] !== undefined) {
        const today = new Date();
        let year = today.getFullYear();
        const candidate = new Date(year, monthMap[monthMatch[2]], Number(monthMatch[1]));

        if (candidate < sumarDias(inicioDelDia(today), -180)) {
            year += 1;
        }

        return formatearFechaISO(new Date(year, monthMap[monthMatch[2]], Number(monthMatch[1])));
    }

    const slashMatch = normalized.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (slashMatch) {
        const day = Number(slashMatch[1]);
        const month = Number(slashMatch[2]) - 1;
        const rawYear = Number(slashMatch[3]);
        const year = rawYear < 100 ? 2000 + rawYear : rawYear;
        return formatearFechaISO(new Date(year, month, day));
    }

    const parsed = new Date(dateText);
    if (!Number.isNaN(parsed.getTime())) {
        return formatearFechaISO(parsed);
    }

    return formatearFechaISO(new Date());
}

function extraerDatosRuta(text) {
    const codigosAeropuertos = Object.keys(airportDatabase);
    const tokens = text.match(/\b[A-Z]{3}\b/g) || [];
    const encontrados = tokens.filter((codigo, index) => codigosAeropuertos.includes(codigo) && tokens.indexOf(codigo) === index);
    
    if (encontrados.length >= 2) {
        return {
            route: `${encontrados[0]} → ${encontrados[1]}`,
            origin: encontrados[0],
            destination: encontrados[1]
        };
    }
    
    return {
        route: "---",
        origin: "MAD",
        destination: "MXP"
    };
}

function normalizeFlightNumber(value) {
    const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const prefix = compact.slice(0, 2).replace(/0/g, "O").replace(/1/g, "I");
    const suffix = compact.slice(2).replace(/O/g, "0").replace(/I|L/g, "1").replace(/S/g, "5").replace(/B/g, "8");
    return `${prefix}${suffix}`;
}

function normalizeSeatCode(value) {
    const compact = String(value || "").toUpperCase().replace(/\s+/g, "");
    const match = compact.match(/^([0-9OISB]{1,3})([A-Z])$/);
    if (!match) return compact;
    return `${match[1].replace(/O/g, "0").replace(/I|L/g, "1").replace(/S/g, "5").replace(/B/g, "8")}${match[2]}`;
}

function getKeywordValue(text, keywords, valuePattern = "([A-Z0-9][A-Z0-9\\s\\-]{1,28})") {
    for (const keyword of keywords) {
        const pattern = new RegExp(`\\b${keyword}\\s*[:#\\-]?\\s*${valuePattern}`, "i");
        const match = text.match(pattern);
        if (match?.[1]) return match[1].trim().replace(/\s{2,}/g, " ");
    }
    return "";
}

function extraerOperadoraTren(text) {
    const operators = ["RENFE", "AVLO", "OUIGO", "ITALO", "TRENITALIA", "SNCF"];
    const found = operators.find(operator => new RegExp(`\\b${operator}\\b`, "i").test(text));
    return found || getKeywordValue(text, ["OPERADORA", "OPERATOR", "COMPAGNIA", "CARRIER"]) || "Operadora no identificada";
}

function extraerNumeroTren(text) {
    const direct = getKeywordValue(text, ["TRAIN", "TREN", "TRENO", "N(?:UMERO)?\\s*TREN", "TRAIN\\s*NO", "NO\\s*TREN"], "([A-Z]{0,3}\\s?[0-9OISB]{2,6})");
    if (direct) return direct.toUpperCase().replace(/\s+/g, "").replace(/O/g, "0").replace(/I|L/g, "1").replace(/S/g, "5").replace(/B/g, "8");

    const match = text.match(/\b(?:AVE|AVLO|OUIGO|ITALO|FRECCIAROSSA|FR|IC|EC|TGV)?\s?([0-9OISB]{3,6})\b/i);
    return match ? match[0].toUpperCase().replace(/\s+/g, "").replace(/O/g, "0").replace(/I|L/g, "1").replace(/S/g, "5").replace(/B/g, "8") : "---";
}

function extraerDatosRutaTren(text) {
    const stationNames = [
        "MADRID", "BARCELONA", "VALENCIA", "SEVILLA", "MALAGA", "ZARAGOZA", "ALICANTE", "CORDOBA", "GIRONA",
        "ROMA", "MILANO", "MILAN", "FIRENZE", "FLORENCE", "VENEZIA", "NAPOLI", "TURIN", "TORINO",
        "PARIS", "LYON", "MARSEILLE", "NICE", "TOULOUSE", "BORDEAUX", "LILLE", "MONTPELLIER"
    ];

    const origin = getKeywordValue(text, ["ORIGEN", "FROM", "DEPARTURE", "SALIDA", "PARTENZA"], "([A-ZÀ-Ü\\s\\-]{3,32})");
    const destination = getKeywordValue(text, ["DESTINO", "TO", "ARRIVAL", "LLEGADA", "ARRIVO"], "([A-ZÀ-Ü\\s\\-]{3,32})");
    if (origin && destination) {
        return {
            origin: cleanStationName(origin),
            destination: cleanStationName(destination),
            route: `${cleanStationName(origin)} → ${cleanStationName(destination)}`
        };
    }

    const found = stationNames.filter(name => new RegExp(`\\b${name}\\b`, "i").test(text));
    if (found.length >= 2) {
        return { origin: found[0], destination: found[1], route: `${found[0]} → ${found[1]}` };
    }

    return { origin: "---", destination: "---", route: "---" };
}

function cleanStationName(value) {
    return String(value || "")
        .replace(/\b(TRAIN|TREN|TRENO|DATE|FECHA|HORA|TIME|SEAT|ASIENTO|VAGON|COACH)\b.*$/i, "")
        .trim()
        .replace(/\s{2,}/g, " ");
}

function extraerHorasTren(text) {
    const departure = getKeywordValue(text, ["SALIDA", "DEPARTURE", "DEP", "PARTENZA"], "([0-2]?[0-9][:.][0-5][0-9])");
    const arrival = getKeywordValue(text, ["LLEGADA", "ARRIVAL", "ARR", "ARRIVO"], "([0-2]?[0-9][:.][0-5][0-9])");
    const times = Array.from(text.matchAll(/\b([0-2]?[0-9][:.][0-5][0-9])\b/g)).map(match => match[1].replace(".", ":").padStart(5, "0"));

    return {
        departure: (departure || times[0] || "").replace(".", ":").padStart(5, "0"),
        arrival: (arrival || times[1] || "").replace(".", ":").padStart(5, "0")
    };
}

function extraerVagonTren(text) {
    const value = getKeywordValue(text, ["VAGON", "VAGÓN", "COACH", "CAR", "VOITURE", "CARROZZA"], "([A-Z0-9]{1,4})");
    return value ? value.toUpperCase() : "---";
}

function extraerAsientoTren(text) {
    const value = getKeywordValue(text, ["ASIENTO", "SEAT", "POSTO", "PLACE", "SITZ"], "([0-9OISB]{1,3}[A-Z]?)");
    return value ? normalizeSeatCode(value) : "---";
}

function extraerClaseTren(text) {
    if (/\b(BUSINESS|PREFERENTE|COMFORT|PRIMA|EXECUTIVE)\b/i.test(text)) return "Business";
    if (/\b(STANDARD|TURISTA|SMART|BASIC|ESSENTIAL|SEGUNDA|2A|2ª)\b/i.test(text)) return "Standard";
    if (/\b(PRIMERA|FIRST|1A|1ª)\b/i.test(text)) return "First";
    return "Standard";
}

function extraerAndenTren(text) {
    const value = getKeywordValue(text, ["ANDEN", "ANDÉN", "PLATFORM", "BINARIO", "VOIE"], "([A-Z0-9]{1,4})");
    return value ? value.toUpperCase() : "---";
}

function extraerDuracionTren(text, times) {
    const direct = text.match(/\b(?:DURATION|DURACION|DURACIÓN|DURATA)\s*[:\-]?\s*([0-9]{1,2}\s?H(?:\s?[0-9]{1,2}\s?M)?|[0-9]{1,3}\s?MIN)\b/i);
    if (direct?.[1]) return direct[1].toUpperCase().replace(/\s+/g, " ");

    if (times?.departure && times?.arrival) {
        const [dh, dm] = times.departure.split(":").map(Number);
        const [ah, am] = times.arrival.split(":").map(Number);
        let minutes = (ah * 60 + am) - (dh * 60 + dm);
        if (minutes < 0) minutes += 24 * 60;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${h}h ${m}m`;
    }

    return "---";
}

// ==========================================
// ACTUALIZAR PANTALLA CON DATOS DEL VUELO
// ==========================================
function actualizarPantalla() {
    currentFlight.flightDate = currentFlight.flightDate || resolverFechaVueloISO(currentFlight.date);

    if (currentFlight.transportType === "train") {
        actualizarPantallaTren();
        return;
    }

    // Datos básicos
    setText("flight", `🛫 ${currentFlight.flight}`);
    setText("route", `📍 ${currentFlight.route}`);
    setText("seat", `💺 ${currentFlight.seat}`);
    setText("terminal", `🛅 ${currentFlight.terminal || '---'}`);
    setText("flightClass", `🎟️ ${currentFlight.flightClass || 'Turista'}`);
    setText("baggage", `🧳 ${currentFlight.baggage || '1 PC incluido'}`);
    setText("date", `📅 ${currentFlight.date}`);
    setText("gate", `🚪 ${currentFlight.gate || '---'}`);
    updateJourneyPanel();
    actualizarChecklistVuelo();
    ensureFlightPackingList();
    renderPackingChecklist();
    updateSeatRecommendation();
    updatePassportStamps();
    renderAssistantState(
        "Estoy preparando avisos inteligentes del vuelo con fecha, clima, puerta y destino.",
        "Analizando vuelo",
        [{ label: "Procesando datos" }],
        [{
            title: "Calculando alertas",
            detail: "Estoy cruzando la ruta, el clima y la fecha del vuelo para darte avisos útiles.",
            icon: "🧠",
            severity: "success"
        }],
        [{
            title: "Preparando viaje",
            detail: "En unos instantes tendrás recomendaciones de check-in, equipaje y puerta."
        }]
    );
    
    // Enriquecer con datos adicionales
    enriquecerDatosVuelo();
}

function actualizarPantallaTren() {
    setText("flight", `🚆 ${currentFlight.trainNumber || currentFlight.flight || "---"}`);
    setText("route", `📍 ${currentFlight.route || "---"}`);
    setText("seat", `💺 ${currentFlight.coach && currentFlight.coach !== "---" ? `Vagón ${currentFlight.coach} · ` : ""}${currentFlight.seat || "---"}`);
    setText("terminal", `🛤️ Andén ${currentFlight.gate || "---"}`);
    setText("flightClass", `🎟️ ${currentFlight.trainClass || currentFlight.flightClass || "Standard"}`);
    setText("baggage", "🧳 Equipaje según tarifa ferroviaria");
    setText("date", `📅 ${currentFlight.date || "---"}`);
    setText("gate", `🛤️ ${currentFlight.gate || "---"}`);
    setText("airline", `🏢 ${currentFlight.operatorName || "Operadora no identificada"}`);
    setText("aircraft", "🚆 Tren");
    setText("duration", `⏱️ ${currentFlight.durationText || "---"}`);
    setText("distance", "📏 Ruta ferroviaria");
    setText("weather", "🌤️ Disponible si consultas el destino con conexión");
    setText("timezone", `🕐 Salida ${currentFlight.departureTime || "---"} · Llegada ${currentFlight.arrivalTime || "---"}`);
    setText("flightPathText", `🚆 ${currentFlight.route || "Ruta ferroviaria"}`);
    setText("distanceDisplay", "---");
    setText("durationDisplay", currentFlight.durationText || "---");
    updateJourneyPanel();
    actualizarChecklistVuelo();
    ensureFlightPackingList();
    renderPackingChecklist();
    renderAssistantState(
        "Billete de tren detectado con datos principales guardados para usar offline.",
        "Journey Cockpit",
        [{ label: "Tren" }, { label: currentFlight.operatorName || "Operadora" }],
        [{
            title: "Código guardado",
            detail: currentFlight.qrRaw ? "El código del billete queda guardado como recuerdo del viaje." : "No se detectó código visual, pero se guardó el texto leído.",
            icon: "🔳",
            severity: "success"
        }],
        [{
            title: "Datos ferroviarios",
            detail: `Tren ${currentFlight.trainNumber || "---"} · ${currentFlight.route || "---"}`
        }]
    );
}

function updateJourneyPanel() {
    const isTrain = currentFlight.transportType === "train";
    setText("journeyType", `Tipo: ${isTrain ? "Tren" : "Vuelo"}`);
    setText("journeyOperator", `Operadora: ${isTrain ? (currentFlight.operatorName || "---") : (currentFlight.airlineName || "---")}`);
    setText("journeyNumber", `Número: ${isTrain ? (currentFlight.trainNumber || currentFlight.flight || "---") : (currentFlight.flight || "---")}`);
    setText("journeyRoute", `Origen / destino: ${currentFlight.route || "---"}`);
    setText("journeyTimes", `Salida / llegada: ${currentFlight.departureTime || "---"} / ${currentFlight.arrivalTime || currentFlight.boardingTime || "---"}`);
    setText("journeySeat", `Vagón / asiento: ${isTrain ? `${currentFlight.coach || "---"} / ${currentFlight.seat || "---"}` : `--- / ${currentFlight.seat || "---"}`}`);
    setText("journeyClass", `Clase: ${currentFlight.trainClass || currentFlight.flightClass || "---"}`);
    setText("journeyPlatform", `Andén / puerta: ${isTrain ? (currentFlight.gate || "---") : (currentFlight.gate || "---")}`);
    setText("journeyQrMemory", `Código QR: ${formatQrMemory(currentFlight.qrRaw)}`);
}

function formatQrMemory(value) {
    if (!value) return "---";
    const compact = String(value).replace(/\s+/g, " ").trim();
    return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;
}

async function enriquecerDatosVuelo() {
    // Detectar aerolínea
    const codigoAerolinea = currentFlight.flight.substring(0, 2);
    const aerolinea = airlineDatabase[codigoAerolinea];
    
    if (aerolinea) {
        currentFlight.airlineName = aerolinea.nombre;
        currentFlight.aircraftName = aerolinea.avion;
        setText("airline", `🏢 ${aerolinea.nombre}`);
        setText("aircraft", `✈️ ${aerolinea.avion}`);
    } else {
        currentFlight.airlineName = "Desconocida";
        currentFlight.aircraftName = "No identificado";
        setText("airline", "🏢 Desconocida");
        setText("aircraft", "✈️ No identificado");
    }
    updateJourneyPanel();
    
    // Calcular datos de ruta
    calcularDatosRuta();
    
    // Mostrar en el mapa
    mostrarRutaEnMapa();

    // Cargar clima real o predicción según la fecha del vuelo
    await cargarClimaVuelo();
    await updateSmartAssistant();
}

function calcularDatosRuta() {
    const origen = airportDatabase[currentFlight.origin];
    const destino = airportDatabase[currentFlight.destination];
    
    if (origen && destino) {
        // Calcular distancia
        const distancia = calcularDistancia(
            origen.lat, origen.lng, 
            destino.lat, destino.lng
        );
        
        // Estimar duración (velocidad promedio 800 km/h)
        const duracionHoras = distancia / 800;
        const horas = Math.floor(duracionHoras);
        const minutos = Math.round((duracionHoras - horas) * 60);
        
        // Actualizar UI
        currentFlight.distanceKm = Math.round(distancia);
        currentFlight.durationMinutes = (horas * 60) + minutos;
        setText("distance", `📏 ${Math.round(distancia)} km`);
        setText("duration", `⏱️ ${horas}h ${minutos}m`);
        
        // Actualizar estadísticas
        document.getElementById('distanceDisplay').textContent = `${Math.round(distancia)} km`;
        document.getElementById('durationDisplay').textContent = `${horas}h ${minutos}m`;
        
        setText("weather", "🌤️ Consultando clima...");
        setText("timezone", "🕐 Calculando...");
    } else {
        setText("distance", "📏 Calculando...");
        setText("duration", "⏱️ Calculando...");
    }

    updateConversionSummary();
}

// ==========================================
// FUNCIONES DEL MAPA LEAFLET
// ==========================================
function mostrarRutaEnMapa() {
    if (!map) inicializarMapa();
    
    const origen = airportDatabase[currentFlight.origin];
    const destino = airportDatabase[currentFlight.destination];
    
    if (!origen || !destino) return;
    
    // Limpiar mapa
    limpiarMapa();
    
    // Actualizar texto
    document.getElementById('flightPathText').textContent = 
        `🌍 ${origen.ciudad} (${currentFlight.origin}) → ${destino.ciudad} (${currentFlight.destination})`;
    
    // Crear puntos de ruta
    puntosRuta = [
        [origen.lat, origen.lng],
        [destino.lat, destino.lng]
    ];
    
    // Dibujar línea de ruta
    rutaActual = L.polyline(puntosRuta, {
        color: '#2f80ed',
        weight: 4,
        opacity: 0.8,
        smoothFactor: 1,
        className: 'flight-route-line'
    }).addTo(map);
    
    // Marcadores de aeropuertos
    marcadorOrigen = L.marker([origen.lat, origen.lng], {
        icon: crearIconoAeropuerto('origin')
    }).bindPopup(`
        <b>🛫 ${currentFlight.origin}</b><br>
        ${origen.nombre}<br>
        ${origen.ciudad}, ${origen.pais}
    `).addTo(map);
    
    marcadorDestino = L.marker([destino.lat, destino.lng], {
        icon: crearIconoAeropuerto('destination')
    }).bindPopup(`
        <b>🛬 ${currentFlight.destination}</b><br>
        ${destino.nombre}<br>
        ${destino.ciudad}, ${destino.pais}
    `).addTo(map);
    
    // Marcador del avión
    marcadorAvion = L.marker([origen.lat, origen.lng], {
        icon: L.divIcon({
            html: '✈',
            className: 'plane-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        })
    }).addTo(map);
    
    // Ajustar vista del mapa
    map.fitBounds(rutaActual.getBounds(), { padding: [50, 50] });
    
    // Abrir popups
    marcadorOrigen.openPopup();
    setTimeout(() => marcadorDestino.openPopup(), 500);
}

function animarVuelo() {
    if (!puntosRuta.length) {
        mostrarNotificacion('Primero carga un vuelo', 'warning');
        return;
    }
    
    // Limpiar animación anterior
    if (intervaloAnimacion) clearInterval(intervaloAnimacion);
    
    indiceAnimacion = 0;
    const origen = puntosRuta[0];
    const destino = puntosRuta[1];
    
    // Posicionar avión al inicio
    marcadorAvion.setLatLng(origen);
    marcadorAvion.bindPopup('🛫 Despegando...').openPopup();
    
    // Calcular pasos de animación
    const pasos = 100;
    const deltaLat = (destino[0] - origen[0]) / pasos;
    const deltaLng = (destino[1] - origen[1]) / pasos;
    
    // Calcular duración realista basada en distancia
    const distance = currentFlight.distanceKm || 1000; // km
    const avgSpeed = 850; // km/h
    const realFlightHours = distance / avgSpeed;
    const animationSecondsPerHour = 3600; // 3600 segundos (1 hora) de animación por hora real para tiempo real
    const baseAnimationMs = realFlightHours * animationSecondsPerHour * 1000;
    const actualAnimationMs = baseAnimationMs / speedMultiplier;
    const intervalMs = actualAnimationMs / pasos;
    
    // Animar
    intervaloAnimacion = setInterval(() => {
        indiceAnimacion++;
        
        if (indiceAnimacion <= pasos) {
            const nuevaLat = origen[0] + (deltaLat * indiceAnimacion);
            const nuevaLng = origen[1] + (deltaLng * indiceAnimacion);
            
            marcadorAvion.setLatLng([nuevaLat, nuevaLng]);
            
            // Actualizar progreso
            const progreso = Math.round((indiceAnimacion / pasos) * 100);
            marcadorAvion.setPopupContent(`✈ En vuelo - ${progreso}%`);
            
            // Suavizar movimiento del mapa (opcional)
            if (indiceAnimacion % 10 === 0) {
                map.panTo([nuevaLat, nuevaLng], { animate: true, duration: 0.5 });
            }
            
            if (indiceAnimacion === pasos) {
                marcadorAvion.setPopupContent('🛬 ¡Aterrizado!').openPopup();
                clearInterval(intervaloAnimacion);
                intervaloAnimacion = null;
                mostrarNotificacion('✅ Vuelo completado', 'success');
            }
        } else {
            clearInterval(intervaloAnimacion);
            intervaloAnimacion = null;
        }
    }, Math.max(intervalMs, 10)); // mínimo 10ms para evitar intervalos demasiado pequeños
}

function limpiarMapa() {
    if (rutaActual) map.removeLayer(rutaActual);
    if (marcadorOrigen) map.removeLayer(marcadorOrigen);
    if (marcadorDestino) map.removeLayer(marcadorDestino);
    if (marcadorAvion) map.removeLayer(marcadorAvion);
    if (intervaloAnimacion) {
        clearInterval(intervaloAnimacion);
        intervaloAnimacion = null;
    }
}

function resetearMapa() {
    limpiarMapa();
    map.setView([43, 2], 5);
    document.getElementById('flightPathText').textContent = '🌍 Ruta: ---';
    document.getElementById('distanceDisplay').textContent = '--- km';
    document.getElementById('durationDisplay').textContent = '---';
}

// ==========================================
// FUNCIONES DE TRANSPORTE TERRESTRE
// ==========================================
function calcularTransporteTerrestre() {
    const origin = document.getElementById('homeAddress').value.trim();
    const destination = document.getElementById('destinationAddress').value.trim();
    const transportMode = document.getElementById('transportModeSelect').value;

    if (!origin || !destination) {
        mostrarNotificacion('Ingresa ambas direcciones', 'warning');
        return;
    }

    // Usar Google Maps Directions API
    if (typeof google !== 'undefined' && google.maps) {
        calcularRutaReal(origin, destination, transportMode);
    } else {
        // Fallback a simulación mejorada
        calcularRutaSimulada(origin, destination, transportMode);
    }
}

function calcularRutaReal(origin, destination, mode) {
    const directionsService = new google.maps.DirectionsService();
    
    // Mapear tipos de transporte a modos de Google Maps
    let travelMode;
    let drivingOptions = undefined;
    let transitOptions = undefined;
    
    switch(mode) {
        case 'driving':
        case 'taxi':
        case 'uber':
        case 'cabify':
        case 'motorcycle':
        case 'scooter':
            travelMode = google.maps.TravelMode.DRIVING;
            drivingOptions = {
                departureTime: new Date(),
                trafficModel: google.maps.TrafficModel.BEST_GUESS
            };
            break;
        case 'transit':
        case 'train':
        case 'subway':
        case 'bus':
            travelMode = google.maps.TravelMode.TRANSIT;
            transitOptions = {
                departureTime: new Date()
            };
            break;
        case 'bicycle':
            travelMode = google.maps.TravelMode.BICYCLING;
            break;
        case 'walking':
            travelMode = google.maps.TravelMode.WALKING;
            break;
        case 'flight':
            // Para vuelos, usar simulación ya que Google Maps no maneja rutas aéreas
            calcularRutaSimulada(origin, destination, mode);
            return;
        default:
            travelMode = google.maps.TravelMode.DRIVING;
    }
    
    const request = {
        origin: origin,
        destination: destination,
        travelMode: travelMode,
        drivingOptions: drivingOptions,
        transitOptions: transitOptions
    };

    directionsService.route(request, (result, status) => {
        if (status === google.maps.DirectionsStatus.OK) {
            mostrarResultadoRuta(result, mode);
        } else {
            console.error('Error en Directions API:', status);
            mostrarNotificacion('Error al calcular ruta. Usando simulación.', 'warning');
            calcularRutaSimulada(origin, destination, mode);
        }
    });
}

function mostrarResultadoRuta(result, mode) {
    const route = result.routes[0];
    const leg = route.legs[0];
    
    const duration = leg.duration.text;
    const durationInTraffic = leg.duration_in_traffic ? leg.duration_in_traffic.text : duration;
    const distance = leg.distance.text;
    const distanceKm = leg.distance.value / 1000;
    
    // Calcular costo basado en el tipo de transporte
    const costInfo = calcularCostoTransporte(mode, distanceKm, leg.duration.value / 60);
    
    // Obtener emoji y nombre del transporte
    const transportInfo = getTransportInfo(mode);
    
    // Actualizar UI
    document.getElementById('transportTitle').innerHTML = `${transportInfo.emoji} ${transportInfo.name}`;
    document.getElementById('transportTime').innerHTML = `Tiempo estimado: ${mode === 'driving' || mode === 'taxi' || mode === 'uber' || mode === 'cabify' || mode === 'motorcycle' || mode === 'scooter' ? durationInTraffic + ' (con tráfico)' : duration}`;
    document.getElementById('transportDistance').innerHTML = `Distancia: ${distance}`;
    document.getElementById('transportCost').innerHTML = `Costo aproximado: ${costInfo.cost} €<br>(${costInfo.details})`;
    
    // Mostrar el resultado
    document.getElementById('selectedTransportResult').style.display = 'block';
    
    // Guardar datos para cálculo de salida
    window.lastRouteData = {
        durationMinutes: Math.round(leg.duration.value / 60),
        mode: mode,
        cost: costInfo.cost
    };

    mostrarNotificacion('Ruta calculada con datos reales', 'success');
}

function calcularCostoTransporte(mode, distanceKm, durationMinutes) {
    let cost = 0;
    let details = '';
    
    switch(mode) {
        case 'driving':
            cost = Math.round(distanceKm * 0.15 * 100) / 100;
            details = 'Gasolina (~0.15€/km)';
            break;
        case 'taxi':
            cost = Math.round((2.5 + distanceKm * 1.2) * 100) / 100; // Tarifa base + precio por km
            details = 'Taxi (~2.50€ base + 1.20€/km)';
            break;
        case 'uber':
        case 'cabify':
            cost = Math.round((1.5 + distanceKm * 0.8) * 100) / 100; // Tarifa más baja que taxi
            details = `${mode === 'uber' ? 'Uber' : 'Cabify'} (~1.50€ base + 0.80€/km)`;
            break;
        case 'motorcycle':
        case 'scooter':
            cost = Math.round(distanceKm * 0.08 * 100) / 100; // Menos consumo que coche
            details = `${mode === 'motorcycle' ? 'Motocicleta' : 'Scooter'} (~0.08€/km combustible)`;
            break;
        case 'transit':
        case 'bus':
            cost = Math.round(durationMinutes * 0.1 * 100) / 100;
            details = 'Autobús/Transporte público (~0.10€/min)';
            break;
        case 'train':
        case 'subway':
            cost = Math.round(durationMinutes * 0.08 * 100) / 100;
            details = `${mode === 'train' ? 'Tren' : 'Metro'} (~0.08€/min)`;
            break;
        case 'bicycle':
        case 'walking':
            cost = 0;
            details = 'Gratis';
            break;
        case 'flight':
            cost = Math.round(distanceKm * 0.25 * 100) / 100; // Costo aproximado por km en avión
            details = 'Vuelo (~0.25€/km promedio)';
            break;
        default:
            cost = Math.round(distanceKm * 0.15 * 100) / 100;
            details = 'Estimación general';
    }
    
    return { cost, details };
}

function getTransportInfo(mode) {
    const transportTypes = {
        'driving': { emoji: '🚗', name: 'Coche privado' },
        'taxi': { emoji: '🚕', name: 'Taxi' },
        'uber': { emoji: '🚗', name: 'Uber' },
        'cabify': { emoji: '🚙', name: 'Cabify' },
        'motorcycle': { emoji: '🏍️', name: 'Motocicleta' },
        'scooter': { emoji: '🛵', name: 'Scooter' },
        'transit': { emoji: '🚌', name: 'Transporte público' },
        'bus': { emoji: '🚌', name: 'Autobús' },
        'train': { emoji: '🚂', name: 'Tren' },
        'subway': { emoji: '🚇', name: 'Metro' },
        'bicycle': { emoji: '🚲', name: 'Bicicleta' },
        'walking': { emoji: '🚶', name: 'Caminando' },
        'flight': { emoji: '✈️', name: 'Avión' }
    };
    
    return transportTypes[mode] || { emoji: '🚗', name: 'Transporte' };
}

function calcularRutaSimulada(origin, destination, mode) {
    // Simulación mejorada con datos más realistas
    const baseDistance = Math.random() * 50 + 10; // 10-60 km
    const trafficFactor = Math.random() * 0.5 + 0.8; // 0.8-1.3 (menos tráfico a más)
    
    let duration, speed;
    
    // Calcular velocidad y duración basada en el tipo de transporte
    switch(mode) {
        case 'driving':
        case 'taxi':
        case 'uber':
        case 'cabify':
            speed = 60 * trafficFactor; // 60 km/h con factor de tráfico
            duration = Math.round(baseDistance / speed * 60);
            break;
        case 'motorcycle':
        case 'scooter':
            speed = 45 * trafficFactor; // Más rápido en tráfico
            duration = Math.round(baseDistance / speed * 60);
            break;
        case 'transit':
        case 'bus':
            speed = 25; // 25 km/h promedio autobús
            duration = Math.round(baseDistance / speed * 60);
            break;
        case 'train':
            speed = 80; // 80 km/h promedio tren
            duration = Math.round(baseDistance / speed * 60);
            break;
        case 'subway':
            speed = 35; // 35 km/h promedio metro
            duration = Math.round(baseDistance / speed * 60);
            break;
        case 'bicycle':
            speed = 15; // 15 km/h bicicleta
            duration = Math.round(baseDistance / speed * 60);
            break;
        case 'walking':
            speed = 5; // 5 km/h caminando
            duration = Math.round(baseDistance / speed * 60);
            break;
        case 'flight':
            speed = 800; // 800 km/h avión
            duration = Math.round(baseDistance / speed * 60);
            break;
        default:
            speed = 60 * trafficFactor;
            duration = Math.round(baseDistance / speed * 60);
    }
    
    // Calcular costo
    const costInfo = calcularCostoTransporte(mode, baseDistance, duration);
    
    // Obtener información del transporte
    const transportInfo = getTransportInfo(mode);
    
    // Actualizar UI
    document.getElementById('transportTitle').innerHTML = `${transportInfo.emoji} ${transportInfo.name}`;
    document.getElementById('transportTime').innerHTML = `Tiempo estimado: ${duration} min${(mode === 'driving' || mode === 'taxi' || mode === 'uber' || mode === 'cabify' || mode === 'motorcycle' || mode === 'scooter') ? ' (con tráfico)' : ''}`;
    document.getElementById('transportDistance').innerHTML = `Distancia: ~${Math.round(baseDistance)} km`;
    document.getElementById('transportCost').innerHTML = `Costo aproximado: ${costInfo.cost} €<br>(${costInfo.details})`;
    
    // Mostrar el resultado
    document.getElementById('selectedTransportResult').style.display = 'block';
    
    // Guardar datos para cálculo de salida
    window.lastRouteData = {
        durationMinutes: duration,
        mode: mode,
        cost: costInfo.cost
    };

    mostrarNotificacion('Ruta calculada (simulación)', 'success');
}

function calcularHoraSalida() {
    const useFlightTime = document.getElementById('useFlightTime').checked;
    let desiredArrivalTime;
    let arrivalDate;

    if (useFlightTime) {
        // Usar la hora del vuelo actual
        if (!currentFlight.date || !currentFlight.departureTime) {
            mostrarNotificacion('No hay vuelo cargado con hora de salida', 'warning');
            return;
        }
        
        // El vuelo tiene departureTime, pero para llegada al aeropuerto necesitamos estimar
        // Asumimos que el vuelo es la hora de llegada deseada
        const flightDateTime = new Date(`${currentFlight.date}T${currentFlight.departureTime}`);
        desiredArrivalTime = flightDateTime.toTimeString().slice(0, 5); // HH:MM
        arrivalDate = flightDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
    } else {
        desiredArrivalTime = document.getElementById('desiredArrivalTime').value;
        const daySelect = document.getElementById('arrivalDay').value;
        
        if (!desiredArrivalTime) {
            mostrarNotificacion('Ingresa la hora deseada de llegada', 'warning');
            return;
        }

        const today = new Date();
        if (daySelect === 'today') {
            arrivalDate = today.toISOString().split('T')[0];
        } else if (daySelect === 'tomorrow') {
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            arrivalDate = tomorrow.toISOString().split('T')[0];
        } else {
            arrivalDate = document.getElementById('customArrivalDate').value;
            if (!arrivalDate) {
                mostrarNotificacion('Selecciona la fecha', 'warning');
                return;
            }
        }
    }

    // Calcular tiempo de viaje (usar datos de ruta calculada)
    let travelTimeMinutes = 45; // default
    if (window.lastRouteData) {
        travelTimeMinutes = window.lastRouteData.durationMinutes;
    } else {
        // Intentar extraer de la UI
        const timeElement = document.getElementById('transportTime');
        const timeMatch = timeElement?.textContent.match(/(\d+)\s*min/);
        if (timeMatch) {
            travelTimeMinutes = parseInt(timeMatch[1]);
        }
    }

    // Margen de antelación
    const bufferMinutes = parseInt(document.getElementById('bufferTime').value);

    // Calcular hora de salida
    const arrivalDateTime = new Date(`${arrivalDate}T${desiredArrivalTime}`);
    const totalMinutesBefore = travelTimeMinutes + bufferMinutes;
    const departureDateTime = new Date(arrivalDateTime.getTime() - totalMinutesBefore * 60000);

    // Formatear resultado
    const departureTimeStr = departureDateTime.toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });
    
    const arrivalTimeStr = arrivalDateTime.toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
    });

    const resultDiv = document.getElementById('departureResult');
    resultDiv.innerHTML = `
        <div style="margin-bottom: 10px;">
            <strong>📅 Llegada deseada:</strong> ${arrivalTimeStr} del ${arrivalDateTime.toLocaleDateString('es-ES')}
        </div>
        <div style="margin-bottom: 10px;">
            <strong>⏱️ Tiempo estimado de viaje:</strong> ${travelTimeMinutes} min
        </div>
        <div style="margin-bottom: 10px;">
            <strong>🛡️ Margen de antelación:</strong> ${bufferMinutes} min
        </div>
        <div style="font-size: 1.2em; color: #4CAF50;">
            <strong>🚗 Debes salir a las ${departureTimeStr}</strong>
        </div>
    `;

    mostrarNotificacion('Hora de salida calculada', 'success');
}

// ==========================================
// FUNCIONES DE GASTOS DEL VIAJE
// ==========================================
function añadirGasto() {
    const description = document.getElementById('expenseDescription').value.trim();
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const category = document.getElementById('expenseCategory').value;

    if (!description || isNaN(amount) || amount <= 0) {
        mostrarNotificacion('Ingresa descripción y monto válido', 'warning');
        return;
    }

    const expense = {
        description,
        amount,
        category,
        date: new Date().toISOString()
    };

    tripExpenses.push(expense);
    guardarGastos();
    actualizarVistaGastos();

    // Limpiar inputs
    document.getElementById('expenseDescription').value = '';
    document.getElementById('expenseAmount').value = '';

    mostrarNotificacion('Gasto añadido', 'success');
}

function guardarGastos() {
    localStorage.setItem('tripExpenses', JSON.stringify(tripExpenses));
}

function cargarGastos() {
    const saved = localStorage.getItem('tripExpenses');
    if (saved) {
        tripExpenses = JSON.parse(saved);
        actualizarVistaGastos();
    }
}

function actualizarVistaGastos() {
    const list = document.getElementById('expensesList');
    const total = tripExpenses.reduce((sum, exp) => sum + exp.amount, 0);

    list.innerHTML = tripExpenses.map((exp, index) => `
        <div class="expense-item">
            <div>
                <strong>${exp.description}</strong> - ${exp.category}
            </div>
            <div>
                ${exp.amount} € 
                <button onclick="eliminarGasto(${index})" style="margin-left: 10px; background: #ff4444; color: white; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer;">X</button>
            </div>
        </div>
    `).join('');

    document.getElementById('totalExpenses').textContent = `${total.toFixed(2)} €`;

    actualizarGraficoGastos();
}

function eliminarGasto(index) {
    tripExpenses.splice(index, 1);
    guardarGastos();
    actualizarVistaGastos();
}

function actualizarGraficoGastos() {
    const ctx = document.getElementById('expensesChart').getContext('2d');
    
    if (expensesChart) {
        expensesChart.destroy();
    }

    const categories = {};
    tripExpenses.forEach(exp => {
        categories[exp.category] = (categories[exp.category] || 0) + exp.amount;
    });

    const labels = Object.keys(categories);
    const data = Object.values(categories);

    expensesChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: [
                    '#FF6384',
                    '#36A2EB',
                    '#FFCE56',
                    '#4BC0C0',
                    '#9966FF'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function crearIconoAeropuerto(tipo) {
    return L.divIcon({
        html: tipo === 'origin' ? '🛫' : '🛬',
        className: `airport-icon airport-${tipo}`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function obtenerZonaHoraria(lng) {
    const horas = Math.round(lng / 15);
    const signo = horas >= 0 ? '+' : '';
    return `GMT${signo}${horas}`;
}

function inicioDelDia(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sumarDias(date, amount) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + amount);
    return copy;
}

function formatearFechaISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatearFechaCorta(dateString) {
    const date = new Date(`${dateString}T00:00:00`);
    return date.toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "short"
    });
}

function codigoClimaATexto(code) {
    const codes = {
        0: "Despejado",
        1: "Mayormente despejado",
        2: "Parcialmente nublado",
        3: "Nublado",
        45: "Niebla",
        48: "Niebla helada",
        51: "Llovizna ligera",
        53: "Llovizna moderada",
        55: "Llovizna intensa",
        61: "Lluvia ligera",
        63: "Lluvia moderada",
        65: "Lluvia intensa",
        71: "Nieve ligera",
        73: "Nieve moderada",
        75: "Nieve intensa",
        80: "Chubascos ligeros",
        81: "Chubascos moderados",
        82: "Chubascos intensos",
        95: "Tormenta"
    };

    return codes[code] || "Condición no disponible";
}

function renderWeatherHistory(days, flightDate) {
    const container = document.getElementById("weatherHistory");
    if (!container) return;

    if (!days.length) {
        container.innerHTML = '<div class="weather-day">Sin datos meteorológicos.</div>';
        return;
    }

    // Calcular fechas para etiquetar correctamente
    const flightDay = new Date(`${flightDate}T00:00:00`);
    const previousDate = formatearFechaISO(sumarDias(flightDay, -1));
    const nextDate = formatearFechaISO(sumarDias(flightDay, 1));

    container.innerHTML = days.map(day => {
        let label = "";
        let className = "";
        
        if (day.date === previousDate) {
            label = "Día anterior";
            className = "is-previous-day";
        } else if (day.date === flightDate) {
            label = "Día del viaje";
            className = "is-flight-day";
        } else if (day.date === nextDate) {
            label = "Día siguiente";
            className = "is-next-day";
        } else {
            label = "Día anterior";
        }

        return `
            <div class="weather-day ${className}">
                <strong>${label} · ${formatearFechaCorta(day.date)}</strong><br>
                ${day.summary} · ${day.tempMin}°C / ${day.tempMax}°C · ${day.precipitation} mm
            </div>
        `;
    }).join("");
}

async function cargarClimaVuelo() {
    const destination = airportDatabase[currentFlight.destination];
    const flightDate = currentFlight.flightDate || resolverFechaVueloISO(currentFlight.date);

    if (!destination || !flightDate) {
        setText("weather", "Weather: ---");
        const container = document.getElementById("weatherHistory");
        if (container) container.innerHTML = "";
        return;
    }

    const startDate = formatearFechaISO(sumarDias(new Date(`${flightDate}T00:00:00`), -WEATHER_LOOKBACK_DAYS));
    const nextDate = formatearFechaISO(sumarDias(new Date(`${flightDate}T00:00:00`), 1));
    const today = inicioDelDia(new Date());
    const flightDayDate = inicioDelDia(new Date(`${flightDate}T00:00:00`));

    try {
        const weatherData = await obtenerResumenMeteorologico(destination, startDate, nextDate, today, flightDayDate);
        const flightDay = weatherData.days.find(day => day.date === flightDate);
        const timezoneLabel = weatherData.timezoneLabel || obtenerZonaHoraria(destination.lng);

        if (flightDay) {
            const sourceLabel = flightDay.isForecast ? "previsto" : "real";
            setText(
                "weather",
                `🌤️ ${destination.ciudad}: ${flightDay.summary}, ${flightDay.tempMin}°C a ${flightDay.tempMax}°C (${sourceLabel})`
            );
        } else {
            setText("weather", `🌤️ ${destination.ciudad}: sin datos disponibles`);
        }

        setText("timezone", `🕐 ${timezoneLabel}`);
        renderWeatherHistory(weatherData.days, flightDate);
    } catch (error) {
        console.error("❌ Error obteniendo clima:", error);
        setText("weather", `🌤️ ${destination.ciudad}: no se pudo obtener el clima`);
        setText("timezone", `🕐 ${obtenerZonaHoraria(destination.lng)}`);
        const container = document.getElementById("weatherHistory");
        if (container) {
            container.innerHTML = '<div class="weather-day">No se pudieron cargar los datos meteorológicos.</div>';
        }
    }
}

async function obtenerResumenMeteorologico(destination, startDate, endDate, today, flightDayDate) {
    const startDay = inicioDelDia(new Date(`${startDate}T00:00:00`));
    const diffStart = Math.round((startDay - today) / 86400000);
    const diffEnd = Math.round((flightDayDate - today) / 86400000);

    let url;

    if (diffStart >= -92 && diffEnd <= 16) {
        const pastDays = Math.max(0, Math.abs(Math.min(diffStart, 0)));
        const forecastDays = Math.max(1, diffEnd >= 0 ? diffEnd + 1 : 1);

        url = `https://api.open-meteo.com/v1/forecast?latitude=${destination.lat}&longitude=${destination.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&past_days=${pastDays}&forecast_days=${forecastDays}`;
    } else {
        url = `https://archive-api.open-meteo.com/v1/archive?latitude=${destination.lat}&longitude=${destination.lng}&start_date=${startDate}&end_date=${endDate}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Weather request failed with status ${response.status}`);
    }

    const data = await response.json();
    const days = [];

    for (let i = 0; i < data.daily.time.length; i++) {
        const date = data.daily.time[i];
        if (date < startDate || date > endDate) continue;

        days.push({
            date,
            summary: codigoClimaATexto(data.daily.weather_code[i]),
            tempMax: Math.round(data.daily.temperature_2m_max[i]),
            tempMin: Math.round(data.daily.temperature_2m_min[i]),
            precipitation: Number(data.daily.precipitation_sum[i] || 0).toFixed(1),
            isForecast: inicioDelDia(new Date(`${date}T00:00:00`)) > today
        });
    }

    return {
        timezoneLabel: data.timezone_abbreviation || data.timezone || "",
        days
    };
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function formatNumber(value) {
    return new Intl.NumberFormat("es-ES").format(value);
}

function formatMinutes(totalMinutes) {
    const safeMinutes = Math.max(0, totalMinutes || 0);
    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;
    return `${hours}h ${minutes}m`;
}

function updateStats() {
    const history = JSON.parse(localStorage.getItem("flights")) || [];
    const countries = new Set();
    const airlines = new Set();
    let totalKm = 0;
    let totalMinutes = 0;

    history.forEach(flight => {
        if (Number.isFinite(flight.distanceKm)) {
            totalKm += flight.distanceKm;
        } else if (flight.origin && flight.destination && airportDatabase[flight.origin] && airportDatabase[flight.destination]) {
            totalKm += Math.round(
                calcularDistancia(
                    airportDatabase[flight.origin].lat,
                    airportDatabase[flight.origin].lng,
                    airportDatabase[flight.destination].lat,
                    airportDatabase[flight.destination].lng
                )
            );
        }

        if (Number.isFinite(flight.durationMinutes)) {
            totalMinutes += flight.durationMinutes;
        }

        if (flight.origin && airportDatabase[flight.origin]) {
            countries.add(airportDatabase[flight.origin].pais);
        }

        if (flight.destination && airportDatabase[flight.destination]) {
            countries.add(airportDatabase[flight.destination].pais);
        }

        if (flight.airlineName) {
            airlines.add(flight.airlineName);
        } else if (flight.flight) {
            const prefix = String(flight.flight).substring(0, 2).toUpperCase();
            if (airlineDatabase[prefix]) {
                airlines.add(airlineDatabase[prefix].nombre);
            }
        }
    });

    setText("statsTotalFlights", formatNumber(history.length));
    setText("statsTotalKm", `${formatNumber(totalKm)} km`);
    setText("statsTotalHours", formatMinutes(totalMinutes));
    setText("statsCountries", formatNumber(countries.size));
    setText("statsAirlines", formatNumber(airlines.size));
}

function updateAirportsHistory() {
    const history = JSON.parse(localStorage.getItem("flights")) || [];
    const container = document.getElementById("airportsHistoryList");
    if (!container) return;

    const airportsMap = new Map();

    history.forEach(flight => {
        [flight.origin, flight.destination].forEach(code => {
            if (!code || !airportDatabase[code]) return;

            const airport = airportDatabase[code];
            const existing = airportsMap.get(code) || {
                code,
                nombre: airport.nombre,
                ciudad: airport.ciudad,
                pais: airport.pais,
                count: 0
            };

            existing.count += 1;
            airportsMap.set(code, existing);
        });
    });

    const airports = Array.from(airportsMap.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.code.localeCompare(b.code);
    });

    if (!airports.length) {
        container.innerHTML = '<p>Sin aeropuertos guardados todavía.</p>';
        return;
    }

    container.innerHTML = airports.map(airport => `
        <div class="airport-history-item">
            <div>
                <strong>${airport.nombre}</strong>
                <small>${airport.ciudad}, ${airport.pais} · ${airport.count} registro(s)</small>
            </div>
            <span class="airport-history-code">${airport.code}</span>
        </div>
    `).join("");
}

function getUpcomingFlights() {
    return JSON.parse(localStorage.getItem("upcomingFlights") || "[]");
}

function saveUpcomingFlights(flights) {
    localStorage.setItem("upcomingFlights", JSON.stringify(flights));
}

function getUploadedBoardingPasses() {
    return JSON.parse(localStorage.getItem("uploadedBoardingPasses") || "[]");
}

function saveUploadedBoardingPasses(flights) {
    localStorage.setItem("uploadedBoardingPasses", JSON.stringify(flights));
}

function registerUploadedBoardingPass(flight) {
    if (!flight || !flight.flight) return;

    const uploaded = getUploadedBoardingPasses();
    const uniqueKey = `${flight.flight}-${flight.flightDate || resolverFechaVueloISO(flight.date)}-${flight.origin}-${flight.destination}`;
    const exists = uploaded.some(item => item.uniqueKey === uniqueKey);
    if (exists) return;

    uploaded.push({
        uniqueKey,
        flight: flight.flight,
        route: flight.route,
        origin: flight.origin,
        destination: flight.destination,
        date: flight.date,
        flightDate: flight.flightDate || resolverFechaVueloISO(flight.date)
    });

    saveUploadedBoardingPasses(uploaded);
}

function normalizeFlightNumber(value) {
    return String(value || "")
        .toUpperCase()
        .replace(/\s+/g, "")
        .trim();
}

function getAirlineNameFromFlightNumber(flightNumber) {
    const prefix = normalizeFlightNumber(flightNumber).substring(0, 2);
    return airlineDatabase[prefix]?.nombre || "Aerolínea pendiente";
}

function getAirportLabel(code) {
    if (!code || !airportDatabase[code]) return code || "---";
    const airport = airportDatabase[code];
    return `${airport.ciudad} (${code})`;
}

function formatearFechaLarga(dateString) {
    return new Date(`${dateString}T00:00:00`).toLocaleDateString("es-ES", {
        weekday: "short",
        day: "2-digit",
        month: "long",
        year: "numeric"
    });
}

function formatTimeLabel(timeString) {
    if (!timeString) return "--:--";
    return String(timeString).replace(".", ":").slice(0, 5);
}

function combineFlightDateAndTime(dateString, timeString) {
    if (!dateString || !timeString) return null;
    const normalizedTime = formatTimeLabel(timeString);
    const date = new Date(`${dateString}T${normalizedTime}:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getRelativeHoursLabel(targetDate) {
    if (!targetDate) return "";
    const diffMs = targetDate.getTime() - Date.now();
    const diffHours = diffMs / 3600000;

    if (diffHours <= 0) return "ahora";
    if (diffHours < 1) return `en ${Math.max(1, Math.round(diffMs / 60000))} min`;
    return `en ${Math.round(diffHours)}h`;
}

function getDaysUntil(dateString) {
    const today = inicioDelDia(new Date());
    const target = inicioDelDia(new Date(`${dateString}T00:00:00`));
    return Math.round((target - today) / 86400000);
}

function getUpcomingFlightBadge(daysUntil) {
    if (daysUntil < 0) return "Pasado";
    if (daysUntil === 0) return "Hoy";
    if (daysUntil === 1) return "Mañana";
    return `En ${daysUntil} días`;
}

function updatePlannerStatus(message) {
    setText("plannerStatus", message);
}

function renderAssistantState(summary, confidence, tags, alerts, facts) {
    const summaryEl = document.getElementById("assistantSummary");
    const confidenceEl = document.getElementById("assistantConfidence");
    const tagsEl = document.getElementById("assistantTags");
    const alertsEl = document.getElementById("assistantAlerts");
    const factsEl = document.getElementById("assistantFacts");

    if (summaryEl) summaryEl.textContent = summary;
    if (confidenceEl) confidenceEl.textContent = confidence;

    if (tagsEl) {
        tagsEl.innerHTML = tags.map(tag => `
            <span class="assistant-tag ${tag.severity ? `is-${tag.severity}` : ""}">${tag.label}</span>
        `).join("");
    }

    if (alertsEl) {
        alertsEl.innerHTML = alerts.map(alert => `
            <div class="assistant-alert ${alert.severity ? `is-${alert.severity}` : ""}">
                <span class="assistant-alert-icon">${alert.icon || "✈️"}</span>
                <div>
                    <strong>${alert.title}</strong>
                    <span>${alert.detail}</span>
                </div>
            </div>
        `).join("");
    }

    if (factsEl) {
        factsEl.innerHTML = facts.map(fact => `
            <div class="assistant-fact">
                <strong>${fact.title}</strong>
                <span>${fact.detail}</span>
            </div>
        `).join("");
    }
}

function renderDefaultAssistantState() {
    renderAssistantState(
        "Escanea una tarjeta y te avisaré de check-in, clima, puerta, documentos y señales del destino.",
        "Esperando vuelo",
        [{ label: "Sin vuelo cargado" }],
        [{
            title: "Asistente inactivo",
            detail: "Cuando detecte una ruta, activaré recordatorios de salida, puerta, destino y preparación.",
            icon: "🛰️",
            severity: "warning"
        }],
        [{
            title: "Listo para escanear",
            detail: "Sube una tarjeta de embarque para personalizar el viaje al momento."
        }]
    );
}

function syncPackingChecklistWithAssistant(weather) {
    const destination = airportDatabase[currentFlight.destination];
    const city = destination?.ciudad || "destino";
    const summary = weather?.daySummary;
    const fallbackTemp = Number.isFinite(weather?.current?.temperature) ? weather.current.temperature : 14;
    const tempMin = Number.isFinite(summary?.tempMin) ? summary.tempMin : fallbackTemp;
    const tempMax = Number.isFinite(summary?.tempMax) ? summary.tempMax : fallbackTemp;
    const rainCode = summary?.weatherCode;
    const rainLikely = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(rainCode) || /lluv|torment|chubasc/i.test(weather?.current?.forecast || "");

    upsertPackingChecklistItem("packingClothing", `Ropa para ${city} (${tempMin}°C a ${tempMax}°C)`);
    upsertPackingChecklistItem(
        "packingUmbrella",
        rainLikely ? `Paraguas para ${city} (hay lluvia prevista)` : `Paraguas plegable por si cambia el tiempo en ${city}`
    );

    if ((airportDatabase[currentFlight.origin]?.pais || "") !== (destination?.pais || "")) {
        upsertPackingChecklistItem("packingDocsPassport", "Documentación, DNI/pasaporte y tarjeta de embarque");
    }
}

async function updateSmartAssistant() {
    if (!currentFlight.flight || currentFlight.flight === "---") {
        renderDefaultAssistantState();
        return;
    }

    const destination = airportDatabase[currentFlight.destination];
    const origin = airportDatabase[currentFlight.origin];
    const flightDate = currentFlight.flightDate || resolverFechaVueloISO(currentFlight.date);
    const daysUntil = getDaysUntil(flightDate);
    const departureAt = combineFlightDateAndTime(flightDate, currentFlight.departureTime);
    const boardingAt = combineFlightDateAndTime(flightDate, currentFlight.boardingTime);
    const gateCloseAt = boardingAt || (departureAt ? new Date(departureAt.getTime() - 20 * 60000) : null);
    let weather = null;

    if (destination) {
        try {
            weather = await fetchDetailedWeatherForFlight(currentFlight.destination, flightDate);
            syncPackingChecklistWithAssistant(weather);
            renderPackingChecklist();
        } catch (error) {
            console.error("❌ Error actualizando asistente inteligente:", error);
        }
    }

    const tags = [];
    const alerts = [];
    const facts = [];
    const city = destination?.ciudad || currentFlight.destination || "tu destino";
    const country = destination?.pais;

    if (daysUntil === 0) {
        tags.push({ label: "Sales hoy", severity: "danger" });
    } else if (daysUntil === 1) {
        tags.push({ label: "Sales mañana", severity: "warning" });
    } else if (daysUntil > 1) {
        tags.push({ label: `Vuelo en ${daysUntil} días`, severity: "success" });
    } else {
        tags.push({ label: "Vuelo pasado", severity: "warning" });
    }

    if (currentFlight.departureTime) {
        tags.push({ label: `Salida ${formatTimeLabel(currentFlight.departureTime)}` });
    }

    if (currentFlight.gate && currentFlight.gate !== "---") {
        tags.push({ label: `Puerta ${currentFlight.gate}` });
    }

    if (currentFlight.boardingGroup && currentFlight.boardingGroup !== "---") {
        tags.push({ label: `Grupo ${currentFlight.boardingGroup}` });
    }

    if (departureAt) {
        const checkInAt = new Date(departureAt.getTime() - 24 * 3600000);
        const relativeCheckIn = getRelativeHoursLabel(checkInAt);

        if (Date.now() >= checkInAt.getTime() && Date.now() < departureAt.getTime()) {
            alerts.push({
                title: "Haz check-in ahora",
                detail: `El check-in ya debería estar abierto para ${currentFlight.flight}. Cierra antes de la salida.`,
                icon: "✅",
                severity: "danger"
            });
        } else if (daysUntil <= 1) {
            alerts.push({
                title: `Haz check-in ${relativeCheckIn}`,
                detail: `La salida estimada es a las ${formatTimeLabel(currentFlight.departureTime)} y conviene activar el check-in cuanto antes.`,
                icon: "🕒",
                severity: "warning"
            });
        }
    } else if (daysUntil === 1) {
        alerts.push({
            title: "Haz check-in mañana",
            detail: `No he detectado la hora exacta del vuelo, pero sales mañana. Ten la app de la aerolínea lista.`,
            icon: "🕒",
            severity: "warning"
        });
    }

    if (weather?.daySummary) {
        const { tempMin, tempMax, weatherCode, wind } = weather.daySummary;
        const rainy = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(weatherCode);
        const windy = Number.isFinite(wind) && wind >= 28;

        if (rainy) {
            alerts.push({
                title: `Mete paraguas en ${city}`,
                detail: `Hay ${codigoClimaATexto(weatherCode).toLowerCase()} prevista y temperaturas entre ${tempMin}°C y ${tempMax}°C.`,
                icon: "☔",
                severity: "warning"
            });
        }

        if (windy) {
            alerts.push({
                title: `Viento fuerte en ${city}`,
                detail: `Se esperan rachas de hasta ${wind} km/h. Mejor lleva una capa exterior y llega con margen.`,
                icon: "💨",
                severity: "warning"
            });
        }
    }

    if (currentFlight.gate && currentFlight.gate !== "---") {
        alerts.push({
            title: "Puerta suele cerrar 20 min antes",
            detail: `Tu puerta ${currentFlight.gate} puede cerrar antes del embarque final. No apures la llegada a la zona de embarque.`,
            icon: "🚪",
            severity: "warning"
        });
    }

    if (country && COUNTRY_TRAVEL_ALERTS[country]) {
        const advisory = COUNTRY_TRAVEL_ALERTS[country];
        alerts.push({
            title: advisory.title,
            detail: advisory.detail,
            icon: advisory.icon,
            severity: advisory.severity
        });
    }

    facts.push({
        title: "Ruta detectada",
        detail: origin && destination
            ? `${origin.ciudad} (${currentFlight.origin}) → ${destination.ciudad} (${currentFlight.destination})`
            : currentFlight.route || "Ruta pendiente"
    });

    facts.push({
        title: "Ventana operativa",
        detail: departureAt
            ? `Salida estimada ${formatearFechaLarga(flightDate)} a las ${formatTimeLabel(currentFlight.departureTime)}.`
            : `Vuelo previsto para ${formatearFechaLarga(flightDate)}.`
    });

    facts.push({
        title: "Tiempo del destino",
        detail: weather?.daySummary
            ? `${city}: ${weather.current.forecast}, ${weather.daySummary.tempMin}°C / ${weather.daySummary.tempMax}°C.`
            : `Preparando tiempo de ${city}.`
    });

    facts.push({
        title: "Embarque recomendado",
        detail: gateCloseAt
            ? `Intenta estar en la puerta antes de las ${gateCloseAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.`
            : "Si no hay hora detectada, llega a puerta con al menos 20 minutos de margen."
    });

    while (alerts.length < 3) {
        alerts.push({
            title: "Documentación a mano",
            detail: "Deja localizador, DNI/pasaporte y tarjeta de embarque accesibles antes de salir.",
            icon: "🧾",
            severity: "success"
        });
    }

    const summary = daysUntil === 1
        ? `Tu vuelo ${currentFlight.flight} sale mañana. He activado avisos de check-in, clima, puerta y preparación para ${city}.`
        : `He revisado ${currentFlight.flight} y ya tengo avisos listos de clima, puerta, tiempos y preparación del viaje.`;
    const confidence = alerts.length >= 4 ? "Asistente activo" : "Seguimiento básico";

    currentFlight.smartInsights = {
        summary,
        confidence,
        tags,
        alerts,
        facts
    };

    renderAssistantState(summary, confidence, tags, alerts.slice(0, 5), facts.slice(0, 4));
}

function renderUpcomingFlightsList() {
    const container = document.getElementById("upcomingFlightsList");
    if (!container) return;

    const flights = getUpcomingFlights()
        .sort((a, b) => a.date.localeCompare(b.date) || a.flightNumber.localeCompare(b.flightNumber));

    if (!flights.length) {
        container.innerHTML = '<p>No hay recordatorios guardados todavía.</p>';
        return;
    }

    container.innerHTML = flights.map(flight => {
        const daysUntil = getDaysUntil(flight.date);
        return `
            <div class="upcoming-flight-item">
                <div>
                    <strong>${flight.flightNumber}</strong>
                    <small>${getAirlineNameFromFlightNumber(flight.flightNumber)} · ${getAirportLabel(flight.destination)} · ${formatearFechaLarga(flight.date)}</small>
                    <small>${flight.routeNote || 'Ruta pendiente de completar'}</small>
                </div>
                <div class="upcoming-flight-meta">
                    <span class="upcoming-flight-badge">${getUpcomingFlightBadge(daysUntil)}</span>
                    <div style="margin-top: 10px;">
                        <button type="button" class="upcoming-flight-delete" data-delete-upcoming="${flight.id}">Eliminar</button>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    container.querySelectorAll("[data-delete-upcoming]").forEach(button => {
        button.addEventListener("click", () => {
            deleteUpcomingFlight(button.dataset.deleteUpcoming);
        });
    });
}

function renderPlannerCalendar() {
    const monthLabel = document.getElementById("plannerMonthLabel");
    const grid = document.getElementById("plannerCalendarGrid");
    if (!monthLabel || !grid) return;

    const flights = getUpcomingFlights();
    const year = plannerCalendarView.getFullYear();
    const month = plannerCalendarView.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstWeekday = (firstDay.getDay() + 6) % 7;
    const totalDays = lastDay.getDate();
    const todayIso = formatearFechaISO(new Date());

    monthLabel.innerText = plannerCalendarView.toLocaleDateString("es-ES", {
        month: "long",
        year: "numeric"
    });

    const days = [];
    for (let i = 0; i < firstWeekday; i++) {
        days.push('<div class="planner-day is-empty"></div>');
    }

    for (let day = 1; day <= totalDays; day++) {
        const dateIso = formatearFechaISO(new Date(year, month, day));
        const count = flights.filter(flight => flight.date === dateIso).length;
        const classes = [
            "planner-day",
            count ? "has-flight" : "",
            dateIso === todayIso ? "is-today" : ""
        ].filter(Boolean).join(" ");

        days.push(`
            <div class="${classes}">
                <span>${day}</span>
                ${count ? `<span class="planner-day-count">${count}</span>` : '<span class="planner-day-count" style="visibility:hidden;">0</span>'}
            </div>
        `);
    }

    grid.innerHTML = days.join("");
}

function renderUpcomingPlanner() {
    renderUpcomingFlightsList();
    renderPlannerCalendar();
}

function saveUpcomingFlightReminder(event) {
    event.preventDefault();

    const flightNumberInput = document.getElementById("upcomingFlightNumber");
    const destinationInput = document.getElementById("upcomingFlightDestination");
    const flightDateInput = document.getElementById("upcomingFlightDate");
    const routeInput = document.getElementById("upcomingFlightRoute");
    if (!flightNumberInput || !destinationInput || !flightDateInput || !routeInput) return;

    const flightNumber = normalizeFlightNumber(flightNumberInput.value);
    const destination = normalizeFlightNumber(destinationInput.value).substring(0, 3);
    const date = flightDateInput.value;
    const routeNote = routeInput.value.trim();

    if (!flightNumber || !date || !destination) {
        updatePlannerStatus("Introduce número de vuelo, destino y fecha para guardar el recordatorio.");
        return;
    }

    if (!airportDatabase[destination]) {
        updatePlannerStatus("El destino IATA no está en la base de datos de aeropuertos.");
        return;
    }

    const flights = getUpcomingFlights();
    const duplicate = flights.find(flight => flight.flightNumber === flightNumber && flight.date === date && flight.destination === destination);
    if (duplicate) {
        updatePlannerStatus("Ese vuelo ya estaba guardado para esa fecha.");
        return;
    }

    flights.push({
        id: `${flightNumber}-${date}-${Date.now()}`,
        flightNumber,
        destination,
        date,
        routeNote
    });

    saveUpcomingFlights(flights);
    renderUpcomingPlanner();
    updateDetailedWeatherWidgets();
    plannerCalendarView = new Date(new Date(`${date}T00:00:00`).getFullYear(), new Date(`${date}T00:00:00`).getMonth(), 1);
    renderPlannerCalendar();
    updatePlannerStatus(`Recordatorio guardado para ${flightNumber} hacia ${getAirportLabel(destination)} el ${formatearFechaLarga(date)}.`);
    flightNumberInput.value = "";
    destinationInput.value = "";
    flightDateInput.value = "";
    routeInput.value = "";
}

function deleteUpcomingFlight(id) {
    const flights = getUpcomingFlights().filter(flight => flight.id !== id);
    saveUpcomingFlights(flights);
    renderUpcomingPlanner();
    updateDetailedWeatherWidgets();
    updatePlannerStatus("Recordatorio eliminado.");
}

function formatVisibilityKm(meters) {
    if (!Number.isFinite(meters)) return "---";
    return `${(meters / 1000).toFixed(1)} km`;
}

async function fetchDetailedWeatherForFlight(destinationCode, flightDate) {
    const cacheKey = `${destinationCode}-${flightDate || "no-date"}`;
    if (weatherDetailCache.has(cacheKey)) {
        return weatherDetailCache.get(cacheKey);
    }

    const destination = airportDatabase[destinationCode];
    if (!destination) return null;

    const today = inicioDelDia(new Date());
    const targetDate = flightDate ? inicioDelDia(new Date(`${flightDate}T00:00:00`)) : today;
    const diffDays = Math.round((targetDate - today) / 86400000);

    const currentUrl = `https://api.open-meteo.com/v1/forecast?latitude=${destination.lat}&longitude=${destination.lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,visibility&timezone=auto`;

    let dailyUrl = "";
    if (diffDays >= -92 && diffDays <= 16) {
        const pastDays = Math.max(0, Math.abs(Math.min(diffDays, 0)));
        const forecastDays = Math.max(1, diffDays >= 0 ? diffDays + 1 : 1);
        dailyUrl = `https://api.open-meteo.com/v1/forecast?latitude=${destination.lat}&longitude=${destination.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,relative_humidity_2m_mean,wind_speed_10m_max,visibility_mean&timezone=auto&past_days=${pastDays}&forecast_days=${forecastDays}`;
    } else if (diffDays < -92) {
        dailyUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${destination.lat}&longitude=${destination.lng}&start_date=${flightDate}&end_date=${flightDate}&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,relative_humidity_2m_mean,wind_speed_10m_max,visibility_mean&timezone=auto`;
    }

    const requests = [fetch(currentUrl)];
    if (dailyUrl) requests.push(fetch(dailyUrl));

    const responses = await Promise.all(requests);
    if (!responses[0].ok) {
        throw new Error(`Current weather request failed: ${responses[0].status}`);
    }

    const currentData = await responses[0].json();
    const dailyData = responses[1] && responses[1].ok ? await responses[1].json() : null;

    let daySummary = null;
    if (dailyData?.daily?.time?.length) {
        const index = dailyData.daily.time.findIndex(item => item === flightDate);
        const resolvedIndex = index >= 0 ? index : 0;
        daySummary = {
            weatherCode: dailyData.daily.weather_code?.[resolvedIndex],
            tempMax: Math.round(dailyData.daily.temperature_2m_max?.[resolvedIndex]),
            tempMin: Math.round(dailyData.daily.temperature_2m_min?.[resolvedIndex]),
            apparent: Math.round(dailyData.daily.apparent_temperature_max?.[resolvedIndex]),
            humidity: Math.round(dailyData.daily.relative_humidity_2m_mean?.[resolvedIndex]),
            wind: Math.round(dailyData.daily.wind_speed_10m_max?.[resolvedIndex]),
            visibility: dailyData.daily.visibility_mean?.[resolvedIndex]
        };
    }

    const result = {
        destination,
        current: {
            temperature: Math.round(currentData.current?.temperature_2m),
            apparent: Math.round(currentData.current?.apparent_temperature),
            humidity: Math.round(currentData.current?.relative_humidity_2m),
            wind: Math.round(currentData.current?.wind_speed_10m),
            visibility: currentData.current?.visibility,
            forecast: codigoClimaATexto(currentData.current?.weather_code)
        },
        daySummary
    };

    weatherDetailCache.set(cacheKey, result);
    return result;
}

function renderDetailedWeatherCards(containerId, cards, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!cards.length) {
        container.innerHTML = `<p>${emptyMessage}</p>`;
        return;
    }

    container.innerHTML = cards.join("");
}

async function updateDetailedWeatherWidgets() {
    const upcomingFlights = getUpcomingFlights()
        .sort((a, b) => a.date.localeCompare(b.date));
    const uploadedFlights = getUploadedBoardingPasses()
        .sort((a, b) => (a.flightDate || "").localeCompare(b.flightDate || ""));

    const upcomingCards = await Promise.all(upcomingFlights.map(async flight => {
        if (!flight.destination || !airportDatabase[flight.destination]) return null;
        try {
            const weather = await fetchDetailedWeatherForFlight(flight.destination, flight.date);
            if (!weather) return null;

            const day = weather.daySummary || {};
            return `
                <div class="weather-detailed-card">
                    <strong>🌤️ Destino: ${weather.destination.ciudad} ${flight.destination}</strong>
                    <small>${flight.flightNumber} · ${formatearFechaLarga(flight.date)}</small>
                    <div class="weather-detailed-grid">
                        <span>Temperatura: ${weather.current.temperature}°C</span>
                        <span>Sensación: ${weather.current.apparent}°C</span>
                        <span>Viento: ${weather.current.wind} km/h</span>
                        <span>Humedad: ${weather.current.humidity}%</span>
                        <span>Visibilidad: ${formatVisibilityKm(weather.current.visibility)}</span>
                        <span>Pronóstico: ${weather.current.forecast}</span>
                        ${Number.isFinite(day.tempMax) ? `<span>Día del vuelo: ${day.tempMin}°C / ${day.tempMax}°C</span>` : ""}
                        ${Number.isFinite(day.wind) ? `<span>Viento ese día: ${day.wind} km/h</span>` : ""}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error("❌ Error cargando clima futuro:", error);
            return `
                <div class="weather-detailed-card">
                    <strong>🌤️ Destino: ${getAirportLabel(flight.destination)}</strong>
                    <small>${flight.flightNumber} · ${formatearFechaLarga(flight.date)}</small>
                    <div class="weather-detailed-grid">
                        <span>No se pudo cargar el tiempo.</span>
                    </div>
                </div>
            `;
        }
    }));

    const uploadedCards = await Promise.all(uploadedFlights.map(async flight => {
        if (!flight.destination || !airportDatabase[flight.destination]) return null;
        try {
            const weather = await fetchDetailedWeatherForFlight(flight.destination, flight.flightDate);
            if (!weather) return null;

            const day = weather.daySummary || {};
            return `
                <div class="weather-detailed-card">
                    <strong>🌤️ Destino: ${weather.destination.ciudad} ${flight.destination}</strong>
                    <small>${flight.flight} · ${flight.route || "Ruta detectada"} · ${flight.date || flight.flightDate}</small>
                    <div class="weather-detailed-grid">
                        <span>Temperatura: ${weather.current.temperature}°C</span>
                        <span>Sensación: ${weather.current.apparent}°C</span>
                        <span>Viento: ${weather.current.wind} km/h</span>
                        <span>Humedad: ${weather.current.humidity}%</span>
                        <span>Visibilidad: ${formatVisibilityKm(weather.current.visibility)}</span>
                        <span>Pronóstico: ${weather.current.forecast}</span>
                        ${Number.isFinite(day.tempMax) ? `<span>Día del vuelo: ${day.tempMin}°C / ${day.tempMax}°C</span>` : ""}
                        ${Number.isFinite(day.apparent) ? `<span>Sensación ese día: ${day.apparent}°C</span>` : ""}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error("❌ Error cargando clima de tarjeta:", error);
            return `
                <div class="weather-detailed-card">
                    <strong>🌤️ Destino: ${getAirportLabel(flight.destination)}</strong>
                    <small>${flight.flight} · ${flight.date || flight.flightDate}</small>
                    <div class="weather-detailed-grid">
                        <span>No se pudo cargar el tiempo.</span>
                    </div>
                </div>
            `;
        }
    }));

    renderDetailedWeatherCards(
        "upcomingWeatherList",
        upcomingCards.filter(Boolean),
        "No hay próximos vuelos con destino definido."
    );
    renderDetailedWeatherCards(
        "savedFlightsWeatherList",
        uploadedCards.filter(Boolean),
        "Todavía no has subido tarjetas de embarque."
    );
}

function shuffleArray(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function pickRandomAirports(count = 3) {
    return shuffleArray(Object.entries(airportDatabase)).slice(0, count);
}

function switchGameTab(gameId) {
    document.querySelectorAll(".game-tab").forEach(tab => {
        tab.classList.toggle("is-active", tab.dataset.game === gameId);
    });

    document.querySelectorAll(".game-screen").forEach(screen => {
        screen.classList.toggle("is-active", screen.id === `game-${gameId}`);
    });
}

function renderOptions(containerId, options, onSelect) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = options.map((option, index) => `
        <button type="button" class="game-option-btn" data-option-index="${index}">
            ${option}
        </button>
    `).join("");

    container.querySelectorAll(".game-option-btn").forEach(button => {
        button.addEventListener("click", () => {
            onSelect(Number(button.dataset.optionIndex));
        });
    });
}

function startRouteGame() {
    const airports = pickRandomAirports(3);
    const correct = airports[0];
    const alternatives = pickRandomAirports(3)
        .filter(item => item[0] !== correct[0])
        .slice(0, 2);
    const options = shuffleArray([
        `${correct[1].ciudad} (${correct[0]})`,
        ...alternatives.map(item => `${item[1].ciudad} (${item[0]})`)
    ]);

    currentRouteGame = {
        answer: `${correct[1].ciudad} (${correct[0]})`
    };

    setText("routeGameQuestion", `¿Qué destino encaja mejor para una ruta que sale de ${correct[1].pais} y apunta a ${correct[1].ciudad}?`);
    setText("routeGameResult", "Selecciona una opción.");
    renderOptions("routeGameOptions", options, index => {
        const selected = options[index];
        const ok = selected === currentRouteGame.answer;
        setText("routeGameResult", ok ? `Correcto: era ${currentRouteGame.answer}.` : `Casi. La respuesta correcta era ${currentRouteGame.answer}.`);
    });
}

function startQuizGame() {
    currentQuizGame = aviationQuizQuestions[Math.floor(Math.random() * aviationQuizQuestions.length)];
    setText("quizGameQuestion", currentQuizGame.question);
    setText("quizGameResult", "Elige una respuesta.");
    renderOptions("quizGameOptions", currentQuizGame.options, index => {
        const ok = index === currentQuizGame.correct;
        setText("quizGameResult", ok ? "Respuesta correcta." : `Incorrecto. La correcta era: ${currentQuizGame.options[currentQuizGame.correct]}.`);
    });
}

function startAirportGame() {
    const [code, airport] = pickRandomAirports(1)[0];
    const countries = shuffleArray([
        airport.pais,
        ...shuffleArray(Object.values(airportDatabase).map(item => item.pais).filter(pais => pais !== airport.pais)).slice(0, 2)
    ]).slice(0, 3);

    currentAirportGame = { answer: airport.pais };
    setText("airportGameQuestion", `¿En qué país está el aeropuerto ${airport.nombre} (${code})?`);
    setText("airportGameResult", "Selecciona un país.");
    renderOptions("airportGameOptions", countries, index => {
        const selected = countries[index];
        const ok = selected === currentAirportGame.answer;
        setText("airportGameResult", ok ? `Correcto: ${airport.nombre} está en ${currentAirportGame.answer}.` : `No exactamente. Está en ${currentAirportGame.answer}.`);
    });
}

function startDistanceGame() {
    const selected = pickRandomAirports(2);
    const [originCode, origin] = selected[0];
    const [destinationCode, destination] = selected[1];
    const realDistance = Math.round(calcularDistancia(origin.lat, origin.lng, destination.lat, destination.lng));

    currentDistanceGame = {
        realDistance,
        routeLabel: `${originCode} → ${destinationCode}`
    };

    setText("distanceGameQuestion", `Estima la distancia entre ${origin.ciudad} (${originCode}) y ${destination.ciudad} (${destinationCode}).`);
    setText("distanceGameResult", "Introduce tu estimación y pulsa comprobar.");
    const input = document.getElementById("distanceGuessInput");
    if (input) input.value = "";
}

function checkDistanceGame() {
    const input = document.getElementById("distanceGuessInput");
    if (!input || !currentDistanceGame) return;

    const guess = Number(input.value);
    if (!Number.isFinite(guess) || guess < 0) {
        setText("distanceGameResult", "Introduce una distancia válida en kilómetros.");
        return;
    }

    const diff = Math.abs(guess - currentDistanceGame.realDistance);
    setText(
        "distanceGameResult",
        `Ruta ${currentDistanceGame.routeLabel}: distancia real ${currentDistanceGame.realDistance} km. Te has desviado ${diff} km.`
    );
}

function setupPaintGame() {
    const wing = document.getElementById("paintPlaneWing");
    const body = document.getElementById("paintPlaneBody");
    const tail = document.getElementById("paintPlaneTail");

    document.querySelectorAll(".paint-btn").forEach(button => {
        button.addEventListener("click", () => {
            const color = button.dataset.color;
            if (wing) wing.setAttribute("fill", color);
            if (tail) tail.setAttribute("fill", color);
            if (body) body.setAttribute("fill", color === "#dfe8ef" ? "#dfe8ef" : "#f4f8fb");
            setText("paintGameResult", `Avión repintado en ${button.innerText.toLowerCase()}.`);
        });
    });
}

function actualizarChecklistVuelo() {
    setText("checklistSeat", currentFlight.seat || "---");
    setText("checklistGate", currentFlight.gate || "---");
    setText("checklistGroup", currentFlight.boardingGroup || "---");

    setChecklistItem("taskBoardingScan", !!currentFlight.rawText);
    setChecklistItem("taskSeatAssigned", !!currentFlight.seat && currentFlight.seat !== "---");
    setChecklistItem("taskGateAssigned", !!currentFlight.gate && currentFlight.gate !== "---");
    setChecklistItem("taskGroupAssigned", !!currentFlight.boardingGroup && currentFlight.boardingGroup !== "---");
}

function setChecklistItem(id, checked) {
    const checkbox = document.getElementById(id);
    if (!checkbox) return;

    checkbox.checked = checked;
    const item = checkbox.closest(".checklist-item");
    if (item) {
        item.classList.toggle("is-complete", checked);
    }
}

function syncChecklistStyles() {
    checklistIds.forEach(id => {
        const checkbox = document.getElementById(id);
        if (!checkbox) return;

        const item = checkbox.closest(".checklist-item");
        if (item) {
            item.classList.toggle("is-complete", checkbox.checked);
        }
    });
}

function mostrarEstadoCarga(mostrar) {
    const loader = document.getElementById('loadingIndicator');
    if (mostrar) {
        if (!loader) {
            const div = document.createElement('div');
            div.id = 'loadingIndicator';
            div.className = 'loading-overlay';
            div.innerHTML = '<div class="loading-spinner"></div><p>Procesando...</p>';
            document.body.appendChild(div);
        }
    } else {
        if (loader) loader.remove();
    }
}

function mostrarNotificacion(mensaje, tipo = 'info') {
    const notif = document.createElement('div');
    notif.className = `notification notification-${tipo}`;
    notif.textContent = mensaje;
    notif.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${tipo === 'success' ? '#33d18b' : tipo === 'error' ? '#ea4335' : '#2f80ed'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 9999;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notif);
    
    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

function getAudioContext() {
    if (!audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            throw new Error("AudioContext no soportado");
        }

        audioContext = new AudioCtx();
    }

    if (audioContext.state === "suspended") {
        audioContext.resume();
    }

    return audioContext;
}

function registerOscillator(oscillator, gainNode) {
    activeOscillators.push(oscillator);
    if (gainNode) activeGainNodes.push(gainNode);
    oscillator.onended = () => {
        activeOscillators = activeOscillators.filter(item => item !== oscillator);
        if (gainNode) {
            activeGainNodes = activeGainNodes.filter(item => item !== gainNode);
        }
    };
}

function playToneSequence(tones) {
    const ctx = getAudioContext();
    let currentTime = ctx.currentTime;

    tones.forEach(tone => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.type = tone.type || "sine";
        oscillator.frequency.setValueAtTime(tone.frequency, currentTime);
        gainNode.gain.setValueAtTime(0.0001, currentTime);
        gainNode.gain.exponentialRampToValueAtTime(tone.volume || 0.08, currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, currentTime + tone.duration);

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.start(currentTime);
        oscillator.stop(currentTime + tone.duration + 0.02);
        registerOscillator(oscillator, gainNode);

        currentTime += tone.gap !== undefined ? tone.gap : tone.duration;
    });
}

function createNoiseBuffer(ctx, duration = 2) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.35;
    }

    return buffer;
}

function stopAllSounds() {
    if (cabinInterval) {
        clearInterval(cabinInterval);
        cabinInterval = null;
    }

    activeOscillators.forEach(oscillator => {
        try {
            oscillator.stop();
        } catch (error) {
            console.debug("Oscillator already stopped", error);
        }
    });

    activeGainNodes.forEach(gainNode => {
        try {
            gainNode.disconnect();
        } catch (error) {
            console.debug("Gain already disconnected", error);
        }
    });

    noiseNodes.forEach(node => {
        try {
            node.source.stop();
            node.source.disconnect();
            node.filter.disconnect();
            node.gain.disconnect();
        } catch (error) {
            console.debug("Noise node already stopped", error);
        }
    });

    noiseNodes = [];
    activeOscillators = [];
    activeGainNodes = [];

    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }

    updateSoundStatus("Sonido detenido.");
}

function updateSoundStatus(text) {
    const status = document.getElementById("soundStatus");
    if (status) {
        status.innerText = text;
    }
}

function playSeatbeltDing() {
    stopAllSounds();
    playToneSequence([
        { frequency: 1046, duration: 0.22, gap: 0.26, volume: 0.07, type: "sine" },
        { frequency: 1318, duration: 0.28, gap: 0.28, volume: 0.08, type: "sine" }
    ]);
    updateSoundStatus("Reproduciendo: Ding del cinturón.");
}

function playScanSuccessTone() {
    stopAllSounds();
    playToneSequence([
        { frequency: 880, duration: 0.14, gap: 0.18, volume: 0.08, type: "triangle" },
        { frequency: 1046, duration: 0.18, gap: 0.18, volume: 0.08, type: "triangle" },
        { frequency: 1318, duration: 0.2, gap: 0.24, volume: 0.06, type: "triangle" }
    ]);
    updateSoundStatus("Escaneo completado con éxito.");
}

function playCaptainAnnouncement() {
    stopAllSounds();
    updateSoundStatus("Reproduciendo: Anuncio del capitán.");

    if (window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(
            "Tripulación, arm doors and cross check. Señores pasajeros, por favor permanezcan sentados con el cinturón abrochado."
        );
        utterance.lang = "es-ES";
        utterance.rate = 0.95;
        utterance.pitch = 0.9;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    } else {
        playToneSequence([
            { frequency: 220, duration: 0.2, gap: 0.25, volume: 0.06, type: "square" },
            { frequency: 196, duration: 0.24, gap: 0.3, volume: 0.06, type: "square" },
            { frequency: 247, duration: 0.4, gap: 0.4, volume: 0.05, type: "triangle" }
        ]);
    }
}

function playTakeoffLanding() {
    stopAllSounds();
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(80, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 3.5);
    gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.4);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 3.7);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 3.8);
    registerOscillator(oscillator, gainNode);
    updateSoundStatus("Reproduciendo: Sonido de despegue / aterrizaje.");
}

function playTurbulence() {
    stopAllSounds();
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gainNode = ctx.createGain();

    source.buffer = createNoiseBuffer(ctx, 2.4);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(90, ctx.currentTime);
    filter.Q.value = 0.8;
    gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.2);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.2);

    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + 2.25);
    noiseNodes.push({ source, filter, gain: gainNode });
    updateSoundStatus("Reproduciendo: Turbulencia suave.");
}

function playCabinAmbience() {
    stopAllSounds();
    const ctx = getAudioContext();

    const baseDrone = () => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(180, ctx.currentTime);
        gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.6);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 5.5);
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 5.6);
        registerOscillator(oscillator, gainNode);
    };

    baseDrone();
    cabinInterval = setInterval(baseDrone, 4200);
    updateSoundStatus("Reproduciendo: Música ambiente de cabina.");
}

function reproducirSonido(tipo) {
    try {
        switch (tipo) {
            case "seatbelt":
                playSeatbeltDing();
                break;
            case "captain":
                playCaptainAnnouncement();
                break;
            case "takeoff":
                playTakeoffLanding();
                break;
            case "turbulence":
                playTurbulence();
                break;
            case "cabin":
                playCabinAmbience();
                break;
            default:
                updateSoundStatus("Sonido no reconocido.");
        }
    } catch (error) {
        console.error("❌ Error de audio:", error);
        updateSoundStatus("No se pudo reproducir el sonido en este navegador.");
    }
}

function cargarVueloDemo() {
    const tomorrow = sumarDias(inicioDelDia(new Date()), 1);
    currentFlight = {
        transportType: "flight",
        flight: "VY8432",
        route: "MAD → MXP",
        origin: "MAD",
        destination: "MXP",
        seat: "23A",
        gate: "B12",
        boardingGroup: "3",
        departureTime: "19:40",
        boardingTime: "19:05",
        rawText: "DEMO BOARDING PASS",
        date: tomorrow.toLocaleDateString(),
        flightDate: formatearFechaISO(tomorrow),
        packingChecklist: getDefaultPackingChecklist(),
        conversionRate: 1,
        conversionUpdatedAt: new Date().toISOString()
    };
    
    actualizarPantalla();
    mostrarNotificacion('🎮 Vuelo de demostración cargado', 'info');
}

function openManualTripModal() {
    const modal = document.getElementById("manualTripModal");
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.getElementById("manualFlightNumber")?.focus();
}

function closeManualTripModal() {
    const modal = document.getElementById("manualTripModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
}

function updateManualTripFields() {
    const type = document.querySelector('input[name="manualTripType"]:checked')?.value || "flight";
    const flightFields = document.querySelector(".manual-flight-fields");
    const trainFields = document.querySelector(".manual-train-fields");
    if (flightFields) flightFields.hidden = type !== "flight";
    if (trainFields) trainFields.hidden = type !== "train";

    document.querySelectorAll(".manual-flight-fields input, .manual-flight-fields textarea").forEach(field => {
        field.disabled = type !== "flight";
    });
    document.querySelectorAll(".manual-train-fields input").forEach(field => {
        field.disabled = type !== "train";
    });
}

function getInputValue(id) {
    return document.getElementById(id)?.value.trim() || "";
}

function formatManualDate(value) {
    if (!value) return new Date().toLocaleDateString();
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function buildManualFlight() {
    const flightNumber = normalizeFlightNumber(getInputValue("manualFlightNumber"));
    const origin = getInputValue("manualFlightOrigin").toUpperCase();
    const destination = getInputValue("manualFlightDestination").toUpperCase();
    const dateValue = getInputValue("manualFlightDate");
    const airlineName = getInputValue("manualAirline");
    const airlineCode = flightNumber.slice(0, 2);
    const airline = airlineDatabase[airlineCode];

    if (origin && origin !== "---" && origin.length !== 3) {
        mostrarNotificacion("Introduce un código IATA de aeropuerto válido (3 letras) para el origen.", "warning");
        return null;
    }

    if (destination && destination !== "---" && destination.length !== 3) {
        mostrarNotificacion("Introduce un código IATA de aeropuerto válido (3 letras) para el destino.", "warning");
        return null;
    }

    return {
        transportType: "flight",
        flight: flightNumber || "---",
        route: origin && destination ? `${origin} → ${destination}` : "---",
        origin: origin || "---",
        destination: destination || "---",
        seat: normalizeSeatCode(getInputValue("manualFlightSeat")) || "---",
        terminal: getInputValue("manualFlightTerminal").toUpperCase() || "---",
        gate: getInputValue("manualFlightGate").toUpperCase() || "---",
        flightClass: "Turista",
        baggage: getInputValue("manualFlightBaggage") || "1 PC incluido",
        notes: getInputValue("manualFlightNotes"),
        airlineName: airlineName || airline?.nombre || "Desconocida",
        aircraftName: airline?.avion || "No identificado",
        boardingGroup: "---",
        departureTime: "",
        boardingTime: "",
        date: formatManualDate(dateValue),
        flightDate: dateValue || formatearFechaISO(new Date()),
        distanceKm: 0,
        rawText: "MANUAL FLIGHT ENTRY",
        qrRaw: ""
    };
}

function buildManualTrain() {
    const operatorName = getInputValue("manualTrainOperator") || "Operadora no identificada";
    const trainNumber = getInputValue("manualTrainNumber").toUpperCase() || "---";
    const origin = getInputValue("manualTrainOrigin") || "---";
    const destination = getInputValue("manualTrainDestination") || "---";
    const departureTime = getInputValue("manualTrainDeparture");

    return {
        transportType: "train",
        flight: trainNumber,
        trainNumber,
        route: origin !== "---" && destination !== "---" ? `${origin} → ${destination}` : "---",
        origin,
        destination,
        operatorName,
        departureTime,
        arrivalTime: "",
        coach: getInputValue("manualTrainCoach").toUpperCase() || "---",
        seat: normalizeSeatCode(getInputValue("manualTrainSeat")) || "---",
        gate: "---",
        terminal: "---",
        flightClass: "Standard",
        trainClass: "Standard",
        durationText: "---",
        date: new Date().toLocaleDateString(),
        flightDate: formatearFechaISO(new Date()),
        rawText: "MANUAL TRAIN ENTRY",
        qrRaw: ""
    };
}

async function handleManualTripSubmit(event) {
    event.preventDefault();
    const type = document.querySelector('input[name="manualTripType"]:checked')?.value || "flight";
    currentFlight = type === "train" ? buildManualTrain() : buildManualFlight();

    if (!currentFlight) {
        return;
    }

    if (!currentFlight.flight || currentFlight.flight === "---") {
        mostrarNotificacion(type === "train" ? "Introduce el número de tren" : "Introduce el número de vuelo", "warning");
        return;
    }

    actualizarPantalla();
    await saveFlight();
    document.getElementById("manualTripForm")?.reset();
    updateManualTripFields();
    closeManualTripModal();
}

// ==========================================
// GUARDAR Y CARGAR HISTORIAL
// ==========================================
async function saveFlight() {
    if (!currentFlight.flight || currentFlight.flight === "---") {
        mostrarNotificacion('No hay viaje para guardar', 'warning');
        return;
    }

    ensureFlightPackingList();
    await ensureAirportData(currentFlight);
    updateConversionSummary();

    let history = JSON.parse(localStorage.getItem("flights")) || [];

    // Añadir timestamp
    currentFlight.savedAt = new Date().toISOString();
    const currentKey = getFlightUniqueKey(currentFlight);
    history = history.filter(item => getFlightUniqueKey(item) !== currentKey);
    history.push(currentFlight);

    // Mantener solo últimos 50 vuelos
    if (history.length > 50) history = history.slice(-50);

    localStorage.setItem("flights", JSON.stringify(history));
    await loadHistory();
    updateStats();
    updateAirportsHistory();
    updatePassportStamps();
    updateDetailedWeatherWidgets();

    mostrarNotificacion(`✅ ${currentFlight.transportType === "train" ? "Tren" : "Vuelo"} guardado en el Logbook`, 'success');
}

function getFlightUniqueKey(flight) {
    return [
        flight.transportType || "flight",
        flight.flight || "",
        flight.trainNumber || "",
        flight.route || "",
        flight.flightDate || flight.date || "",
        flight.seat || "",
        flight.coach || ""
    ].join("|").toUpperCase();
}

async function loadHistory() {
    let history = JSON.parse(localStorage.getItem("flights")) || [];
    let html = "";
    
    if (history.length === 0) {
        html = '<p>📭 No hay viajes guardados</p>';
    } else {
        history.slice(-12).reverse().forEach((f, index) => {
            const realIndex = history.length - 1 - index;
            const fecha = f.date || 'Fecha desconocida';
            const ruta = f.route || 'Ruta no disponible';
            const asiento = f.seat || '---';
            const clase = f.flightClass || 'Turista';
            const isTrain = f.transportType === "train";
            const selectedForDelete = tripsPendingDelete.has(realIndex);
            html += `
                <div class="history-item ${selectedForDelete ? 'is-delete-selected' : ''}" onclick="cargarVueloGuardado(${realIndex})">
                    ${deleteTripsMode ? `<button type="button" class="history-delete-x" onclick="event.stopPropagation(); toggleTripDeleteSelection(${realIndex})" aria-label="Marcar viaje para borrar">×</button>` : ''}
                    <div class="history-header">
                        <strong>${isTrain ? "🚆" : "✈️"} ${f.flight}</strong>
                        <span>${fecha}</span>
                    </div>
                    <div class="history-details">
                        <span>📍 ${ruta}</span>
                        <span>🎟️ ${clase} · 💺 ${isTrain ? `${f.coach || '---'} / ${asiento}` : asiento}</span>
                        <span>${isTrain ? `🛤️ Andén ${f.gate || '---'}` : `🛅 ${f.terminal || '---'} · 🚪 ${f.gate || '---'}`}</span>
                    </div>
                </div>
            `;
        });
    }
    
    document.getElementById("historyList").innerHTML = html;
    updateDeleteTripsControls();
    renderHistorySummary(history);
    await renderHistoryMap(history);
}

function requestDeleteTripsPassword(message) {
    const value = window.prompt(`${message}\n\nContraseña: ${DELETE_TRIPS_PASSWORD}`);
    return value === DELETE_TRIPS_PASSWORD;
}

function enableDeleteTripsMode() {
    if (!requestDeleteTripsPassword("Introduce la contraseña para activar el modo borrar viajes.")) {
        mostrarNotificacion("Contraseña incorrecta", "error");
        return;
    }

    deleteTripsMode = true;
    tripsPendingDelete.clear();
    loadHistory();
    mostrarNotificacion("Modo borrar activado. Pulsa la cruz de los viajes que quieras eliminar.", "info");
}

function cancelDeleteTripsMode() {
    deleteTripsMode = false;
    tripsPendingDelete.clear();
    loadHistory();
    mostrarNotificacion("Modo borrar cerrado", "info");
}

function toggleTripDeleteSelection(index) {
    if (!deleteTripsMode) return;

    if (tripsPendingDelete.has(index)) {
        tripsPendingDelete.delete(index);
    } else {
        tripsPendingDelete.add(index);
    }

    loadHistory();
}

function confirmDeleteTrips() {
    if (!deleteTripsMode) return;

    if (!tripsPendingDelete.size) {
        mostrarNotificacion("Selecciona al menos un viaje con la cruz", "warning");
        return;
    }

    if (!requestDeleteTripsPassword(`Vas a borrar ${tripsPendingDelete.size} viaje(s). Introduce la contraseña otra vez para confirmar.`)) {
        mostrarNotificacion("Contraseña incorrecta. No se borró nada.", "error");
        return;
    }

    const history = JSON.parse(localStorage.getItem("flights")) || [];
    const filtered = history.filter((_, index) => !tripsPendingDelete.has(index));
    localStorage.setItem("flights", JSON.stringify(filtered));

    deleteTripsMode = false;
    tripsPendingDelete.clear();
    loadHistory();
    updateStats();
    updateAirportsHistory();
    updatePassportStamps();
    updateDetailedWeatherWidgets();
    mostrarNotificacion("Viajes borrados correctamente", "success");
}

function updateDeleteTripsControls() {
    const enableBtn = document.getElementById("enableDeleteTripsBtn");
    const confirmBtn = document.getElementById("confirmDeleteTripsBtn");
    const cancelBtn = document.getElementById("cancelDeleteTripsBtn");

    if (enableBtn) enableBtn.hidden = deleteTripsMode;
    if (confirmBtn) {
        confirmBtn.hidden = !deleteTripsMode;
        confirmBtn.textContent = tripsPendingDelete.size
            ? `Confirmar borrado (${tripsPendingDelete.size})`
            : "Confirmar borrado";
    }
    if (cancelBtn) cancelBtn.hidden = !deleteTripsMode;
}

function renderHistorySummary(history) {
    const countries = new Set();
    let totalMinutes = 0;

    history.forEach(flight => {
        if (Number.isFinite(flight.durationMinutes)) {
            totalMinutes += flight.durationMinutes;
        }

        if (flight.origin && airportDatabase[flight.origin]) {
            countries.add(airportDatabase[flight.origin].pais);
        }
        if (flight.destination && airportDatabase[flight.destination]) {
            countries.add(airportDatabase[flight.destination].pais);
        }
    });

    setText("historyFlightCount", formatNumber(history.length));
    setText("historyHoursFlown", formatMinutes(totalMinutes));
    setText("historyCountriesCount", formatNumber(countries.size));
}

async function renderHistoryMap(history) {
    if (!document.getElementById('historyMap')) return;

    if (!historyMap) {
        historyMap = L.map('historyMap', { zoomControl: true, attributionControl: false }).setView([20, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 18,
            className: 'map-tiles'
        }).addTo(historyMap);
    }

    historyLines.forEach(line => historyMap.removeLayer(line));
    historyMarkers.forEach(marker => historyMap.removeLayer(marker));
    historyLines = [];
    historyMarkers = [];

    const colors = ['#ffb248', '#4facff', '#7ef1d1', '#ff7a78', '#9b59ff', '#65a7ff'];
    const bounds = [];

    for (let index = 0; index < history.length; index += 1) {
        const flight = history[index];
        await ensureAirportData(flight);

        const origin = airportDatabase[flight.origin];
        const destination = airportDatabase[flight.destination];

        if (!origin || !destination) continue;

        const color = colors[index % colors.length];
        const path = [[origin.lat, origin.lng], [destination.lat, destination.lng]];

        const line = L.polyline(path, {
            color,
            weight: 4,
            opacity: 0.9,
            smoothFactor: 1
        }).addTo(historyMap);
        historyLines.push(line);

        const originMarker = L.circleMarker([origin.lat, origin.lng], {
            radius: 6,
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.9
        }).bindPopup(`<strong>${origin.nombre}</strong><br>${origin.ciudad}, ${origin.pais}`)
          .addTo(historyMap);
        historyMarkers.push(originMarker);

        const destinationMarker = L.circleMarker([destination.lat, destination.lng], {
            radius: 6,
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.9
        }).bindPopup(`<strong>${destination.nombre}</strong><br>${destination.ciudad}, ${destination.pais}`)
          .addTo(historyMap);
        historyMarkers.push(destinationMarker);

        bounds.push([origin.lat, origin.lng], [destination.lat, destination.lng]);
    }

    if (bounds.length) {
        historyMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 4 });
    }
}

function cargarVueloGuardado(index) {
    if (deleteTripsMode) {
        toggleTripDeleteSelection(index);
        return;
    }

    const history = JSON.parse(localStorage.getItem("flights")) || [];
    if (history[index]) {
        currentFlight = history[index];
        currentFlight.flightDate = currentFlight.flightDate || resolverFechaVueloISO(currentFlight.date);
        actualizarPantalla();
        mostrarNotificacion(`📂 ${currentFlight.transportType === "train" ? "Tren" : "Vuelo"} ${currentFlight.flight} cargado`, 'info');
    }
}

function updateConnectionStatus() {
    const badge = document.getElementById("connectionStatus");
    const button = document.getElementById("enableOfflineBtn");
    if (!badge) return;

    const online = navigator.onLine;
    const mode = getNetworkMode();
    badge.textContent = mode === "offline"
        ? "Modo offline activo"
        : (online ? "Modo online activo" : "Sin conexión: usando caché");
    badge.classList.toggle("is-online", online);
    badge.classList.toggle("is-offline", !online || mode === "offline");

    if (button) {
        button.textContent = mode === "offline" ? "Activar online" : "Activar offline";
        button.setAttribute("aria-pressed", mode === "offline" ? "true" : "false");
    }
}

function openBoardingCamera() {
    const input = document.getElementById("cameraInput") || document.getElementById("imageInput");
    if (!input) return;

    input.setAttribute("capture", "environment");
    input.click();
}

function getOfflineSnapshot() {
    return {
        savedAt: new Date().toISOString(),
        currentFlight,
        flights: JSON.parse(localStorage.getItem("flights") || "[]"),
        upcomingFlights: JSON.parse(localStorage.getItem("upcomingFlights") || "[]"),
        uploadedBoardingPasses: JSON.parse(localStorage.getItem("uploadedBoardingPasses") || "[]"),
        uploadedJourneys: JSON.parse(localStorage.getItem("uploadedJourneys") || "[]"),
        tripExpenses: JSON.parse(localStorage.getItem("tripExpenses") || "[]"),
        packingChecklist: currentFlight.packingChecklist || getDefaultPackingChecklist(),
        airportsAvailable: Object.keys(airportDatabase).length
    };
}

function getNetworkMode() {
    return localStorage.getItem("flightCockpitNetworkMode") === "offline" ? "offline" : "online";
}

async function notifyServiceWorkerNetworkMode(mode) {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    if (registration.active) {
        registration.active.postMessage({ type: "SET_NETWORK_MODE", mode });
    }
}

async function activateOnlineMode() {
    localStorage.setItem("flightCockpitNetworkMode", "online");
    await notifyServiceWorkerNetworkMode("online");
    setText("offlineStatus", "Online activado. La web volverá a usar internet con normalidad y dejará la caché como respaldo si falla la conexión.");
    mostrarNotificacion("Modo online activado", "success");
    updateConnectionStatus();
}

async function activateOfflineMode() {
    const button = document.getElementById("enableOfflineBtn");
    if (!("serviceWorker" in navigator) || !("caches" in window)) {
        setText("offlineStatus", "Este navegador no permite guardar la app completa para usarla offline.");
        mostrarNotificacion("Modo offline no disponible en este navegador", "error");
        return;
    }

    if (button) button.disabled = true;
    setText("offlineStatus", "Preparando caché offline y guardando tus datos de vuelo...");

    try {
        localStorage.setItem("flightCockpitOfflineSnapshot", JSON.stringify(getOfflineSnapshot()));
        localStorage.setItem("flightCockpitNetworkMode", "offline");

        const registration = await navigator.serviceWorker.ready;
        if (registration.active) {
            registration.active.postMessage({ type: "CACHE_OFFLINE_ASSETS" });
            registration.active.postMessage({ type: "SET_NETWORK_MODE", mode: "offline" });
        }

        const cache = await caches.open("flight-cockpit-user-data");
        await cache.put(
            "/offline-snapshot.json",
            new Response(localStorage.getItem("flightCockpitOfflineSnapshot"), {
                headers: { "Content-Type": "application/json" }
            })
        );

        setText("offlineStatus", "Offline activado. En vuelo podrás abrir la app, consultar datos guardados, juegos, historial, checklist y tarjetas ya cargadas.");
        mostrarNotificacion("Modo offline preparado", "success");
    } catch (error) {
        console.error("Error preparando modo offline:", error);
        setText("offlineStatus", "No se pudo completar la caché offline. Abre la app con conexión y vuelve a intentarlo antes del vuelo.");
        mostrarNotificacion("No se pudo activar offline", "error");
    } finally {
        if (button) button.disabled = false;
        updateConnectionStatus();
    }
}

async function toggleNetworkMode() {
    if (getNetworkMode() === "offline") {
        await activateOnlineMode();
        return;
    }

    await activateOfflineMode();
}

// ==========================================
// EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', async function() {
    // Inicializar mapa
    inicializarMapa();
    
    // Cargar historial
    await loadHistory();
    updateStats();
    updateAirportsHistory();
    renderUpcomingPlanner();
    updatePassportStamps();
    updateDetailedWeatherWidgets();
    renderDefaultAssistantState();
    
    // Botón de guardar
    const saveBtn = document.getElementById('saveFlightBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveFlight);
    }

    const openManualTripBtn = document.getElementById("openManualTripBtn");
    if (openManualTripBtn) {
        openManualTripBtn.addEventListener("click", openManualTripModal);
    }

    const closeManualTripBtn = document.getElementById("closeManualTripBtn");
    const cancelManualTripBtn = document.getElementById("cancelManualTripBtn");
    if (closeManualTripBtn) closeManualTripBtn.addEventListener("click", closeManualTripModal);
    if (cancelManualTripBtn) cancelManualTripBtn.addEventListener("click", closeManualTripModal);

    const manualTripModal = document.getElementById("manualTripModal");
    if (manualTripModal) {
        manualTripModal.addEventListener("click", event => {
            if (event.target === manualTripModal) closeManualTripModal();
        });
    }

    document.querySelectorAll('input[name="manualTripType"]').forEach(input => {
        input.addEventListener("change", updateManualTripFields);
    });
    updateManualTripFields();

    const manualTripForm = document.getElementById("manualTripForm");
    if (manualTripForm) {
        manualTripForm.addEventListener("submit", handleManualTripSubmit);
    }

    const enableDeleteTripsBtn = document.getElementById("enableDeleteTripsBtn");
    if (enableDeleteTripsBtn) {
        enableDeleteTripsBtn.addEventListener("click", enableDeleteTripsMode);
    }

    const confirmDeleteTripsBtn = document.getElementById("confirmDeleteTripsBtn");
    if (confirmDeleteTripsBtn) {
        confirmDeleteTripsBtn.addEventListener("click", confirmDeleteTrips);
    }

    const cancelDeleteTripsBtn = document.getElementById("cancelDeleteTripsBtn");
    if (cancelDeleteTripsBtn) {
        cancelDeleteTripsBtn.addEventListener("click", cancelDeleteTripsMode);
    }

    const cameraBoardingBtn = document.getElementById("cameraBoardingBtn");
    if (cameraBoardingBtn) {
        cameraBoardingBtn.addEventListener("click", openBoardingCamera);
    }

    const enableOfflineBtn = document.getElementById("enableOfflineBtn");
    if (enableOfflineBtn) {
        enableOfflineBtn.addEventListener("click", toggleNetworkMode);
    }

    updateConnectionStatus();
    notifyServiceWorkerNetworkMode(getNetworkMode());
    window.addEventListener("online", updateConnectionStatus);
    window.addEventListener("offline", updateConnectionStatus);

    const upcomingFlightForm = document.getElementById("upcomingFlightForm");
    if (upcomingFlightForm) {
        upcomingFlightForm.addEventListener("submit", saveUpcomingFlightReminder);
    }

    const prevPlannerMonthBtn = document.getElementById("prevPlannerMonthBtn");
    if (prevPlannerMonthBtn) {
        prevPlannerMonthBtn.addEventListener("click", () => {
            plannerCalendarView = new Date(plannerCalendarView.getFullYear(), plannerCalendarView.getMonth() - 1, 1);
            renderPlannerCalendar();
        });
    }

    const nextPlannerMonthBtn = document.getElementById("nextPlannerMonthBtn");
    if (nextPlannerMonthBtn) {
        nextPlannerMonthBtn.addEventListener("click", () => {
            plannerCalendarView = new Date(plannerCalendarView.getFullYear(), plannerCalendarView.getMonth() + 1, 1);
            renderPlannerCalendar();
        });
    }

    checklistIds.forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox && !checkbox.disabled) {
            checkbox.addEventListener('change', syncChecklistStyles);
        }
    });
    
    // Botones del mapa
    const animateBtn = document.getElementById('animateFlightBtn');
    if (animateBtn) {
        animateBtn.addEventListener('click', animarVuelo);
    }
    
    const resetBtn = document.getElementById('resetFlightBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetearMapa);
    }

    // Botones de velocidad
    const speedButtons = ['speedRealTime', 'speed2x', 'speed4x', 'speed8x'];
    speedButtons.forEach((id, index) => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                speedMultiplier = [1, 2, 4, 8][index];
                // Actualizar clase active
                speedButtons.forEach(otherId => {
                    document.getElementById(otherId).classList.remove('active');
                });
                btn.classList.add('active');
            });
        }
    });

    document.querySelectorAll('.sound-btn[data-sound]').forEach(button => {
        button.addEventListener('click', () => {
            reproducirSonido(button.dataset.sound);
        });
    });

    const stopAudioBtn = document.getElementById('stopAudioBtn');
    if (stopAudioBtn) {
        stopAudioBtn.addEventListener('click', stopAllSounds);
    }

    const packingItemsList = document.getElementById('packingItemsList');
    if (packingItemsList) {
        packingItemsList.addEventListener('click', handlePackingListClick);
    }

    const togglePackingInputBtn = document.getElementById('togglePackingInputBtn');
    if (togglePackingInputBtn) {
        togglePackingInputBtn.addEventListener('click', () => togglePackingAddRow(true));
    }

    const addPackingItemButton = document.getElementById('addPackingItemButton');
    if (addPackingItemButton) {
        addPackingItemButton.addEventListener('click', () => {
            const input = document.getElementById('newPackingItemInput');
            if (input && input.value.trim()) {
                addPackingChecklistItem(input.value);
                input.value = '';
            }
        });
    }

    const newPackingItemInput = document.getElementById('newPackingItemInput');
    if (newPackingItemInput) {
        newPackingItemInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addPackingItemButton?.click();
            }
        });
    }

    const updateConversionBtn = document.getElementById('updateConversionBtn');
    if (updateConversionBtn) {
        updateConversionBtn.addEventListener('click', updateConversionSummary);
    }

    // Inicializar selector de países
    const destinationCountrySelect = document.getElementById('destinationCountry');
    if (destinationCountrySelect) {
        // Poblar dropdown con países
        const countries = Object.keys(countryDatabase).sort();
        countries.forEach(country => {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country;
            destinationCountrySelect.appendChild(option);
        });
        
        // Agregar event listener para actualizar conversor
        destinationCountrySelect.addEventListener('change', updateConversionSummary);
    }

    togglePackingAddRow(false);
    ensureFlightPackingList();
    renderPackingChecklist();
    updateConversionSummary();

    document.querySelectorAll(".game-tab").forEach(tab => {
        tab.addEventListener("click", () => switchGameTab(tab.dataset.game));
    });

    const startRouteGameBtn = document.getElementById("startRouteGameBtn");
    if (startRouteGameBtn) {
        startRouteGameBtn.addEventListener("click", startRouteGame);
    }

    const startQuizGameBtn = document.getElementById("startQuizGameBtn");
    if (startQuizGameBtn) {
        startQuizGameBtn.addEventListener("click", startQuizGame);
    }

    const startAirportGameBtn = document.getElementById("startAirportGameBtn");
    if (startAirportGameBtn) {
        startAirportGameBtn.addEventListener("click", startAirportGame);
    }

    const startDistanceGameBtn = document.getElementById("startDistanceGameBtn");
    if (startDistanceGameBtn) {
        startDistanceGameBtn.addEventListener("click", startDistanceGame);
    }

    const checkDistanceGameBtn = document.getElementById("checkDistanceGameBtn");
    if (checkDistanceGameBtn) {
        checkDistanceGameBtn.addEventListener("click", checkDistanceGame);
    }

    setupPaintGame();
    startRouteGame();
    startQuizGame();
    startAirportGame();
    startDistanceGame();
    
    // Transporte terrestre
    const calculateTransportBtn = document.getElementById('calculateTransportBtn');
    if (calculateTransportBtn) {
        calculateTransportBtn.addEventListener('click', calcularTransporteTerrestre);
    }

    // Planificación de llegada
    const calculateDepartureBtn = document.getElementById('calculateDepartureBtn');
    if (calculateDepartureBtn) {
        calculateDepartureBtn.addEventListener('click', calcularHoraSalida);
    }

    const useFlightTimeCheckbox = document.getElementById('useFlightTime');
    if (useFlightTimeCheckbox) {
        useFlightTimeCheckbox.addEventListener('change', function() {
            const manualFields = document.querySelector('.arrival-fields');
            manualFields.style.display = this.checked ? 'none' : 'grid';
        });
    }

    const arrivalDaySelect = document.getElementById('arrivalDay');
    if (arrivalDaySelect) {
        arrivalDaySelect.addEventListener('change', function() {
            const customDateInput = document.getElementById('customArrivalDate');
            customDateInput.style.display = this.value === 'custom' ? 'block' : 'none';
        });
    }

    // Gastos del viaje
    const addExpenseBtn = document.getElementById('addExpenseBtn');
    if (addExpenseBtn) {
        addExpenseBtn.addEventListener('click', añadirGasto);
    }

    // Cargar gastos guardados
    cargarGastos();
    
    // Inicializar estado de planificación de llegada
    if (useFlightTimeCheckbox && useFlightTimeCheckbox.checked) {
        document.querySelector('.arrival-fields').style.display = 'none';
    }

    console.log('🚀 Sistema de Cockpit de Vuelo inicializado');
    syncChecklistStyles();
});

// ==========================================
// ESTILOS ADICIONALES PARA NOTIFICACIONES
// ==========================================
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
    
    .loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(6, 21, 24, 0.9);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 9998;
        backdrop-filter: blur(5px);
    }
    
    .loading-spinner {
        width: 50px;
        height: 50px;
        border: 3px solid rgba(51, 209, 139, 0.3);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
        to { transform: rotate(360deg); }
    }
    
    .history-item {
        background: rgba(15, 25, 34, 0.5);
        padding: 12px;
        margin: 8px 0;
        border-radius: 10px;
        border-left: 4px solid var(--accent);
        cursor: pointer;
        transition: all 0.3s ease;
    }
    
    .history-item:hover {
        background: rgba(20, 35, 45, 0.7);
        transform: translateX(5px);
    }
    
    .history-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
    }
    
    .history-header strong {
        color: var(--accent);
    }
    
    .history-details {
        display: flex;
        gap: 15px;
        color: var(--text-soft);
        font-size: 0.9rem;
    }
    
    .flight-route-line {
        filter: drop-shadow(0 0 8px rgba(47, 128, 237, 0.5));
    }
    
    .airport-icon {
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
    }
`;
document.head.appendChild(style);

// Exponer funciones globales
window.saveFlight = saveFlight;
window.cargarVueloGuardado = cargarVueloGuardado;

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js")
        .then(() => console.log("Offline mode active"))
        .catch(error => console.error("Service worker registration failed:", error));
}
