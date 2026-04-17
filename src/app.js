import {
  buildRecommendation,
  calculateScore,
  determineRange,
  evaluateRules,
  getOption,
  validateConfig
} from "./logic.js";

let config = null;
let currentResult = null;

const state = {
  caseData: {},
  selectedFactors: {},
  offenseId: ""
};

const exampleCase = {
  caseData: {
    case_id: "CASO-IA-001",
    date: "2026-04-17",
    course: "Ética y escritura académica",
    reporting_teacher: "Docente de prueba",
    student_name: "Estudiante de ejemplo",
    description: "Uso no autorizado de IA generativa en un informe con impacto relevante en el contenido evaluado.",
    evidence_summary: "Comparación de versiones, declaración parcial y revisión del historial de edición.",
    notes: "Caso precargado solo para probar el flujo de la aplicación."
  },
  offenseId: "F5",
  selectedFactors: {
    intentionality: "intentionality_3",
    academic_impact: "academic_impact_3",
    third_party_impact: "third_party_impact_2",
    recidivism: "recidivism_1",
    acknowledgement: "acknowledgement_2",
    student_year: "student_year_3",
    clinical_context: "clinical_context_1",
    benefit_obtained: "benefit_obtained_2",
    rule_clarity: "rule_clarity_3",
    evidence_strength: "evidence_strength_3",
    critical_context: "critical_context_1"
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  try {
    config = await loadDefaultConfig();
    validateConfig(config);
    initializeStateFromConfig();
    renderApp();
    loadExampleCase();
    calculateAndRender();
  } catch (error) {
    document.querySelector("#config-status").textContent = error.message;
  }

  document.querySelector("#load-example").addEventListener("click", () => {
    loadExampleCase();
    calculateAndRender();
  });
  document.querySelector("#config-file").addEventListener("change", handleConfigUpload);
  document.querySelector("#export-pdf").addEventListener("click", exportResultPdf);
});

async function loadDefaultConfig() {
  const response = await fetch("config/default-config.json");
  if (!response.ok) throw new Error("No se pudo cargar config/default-config.json.");
  return response.json();
}

function initializeStateFromConfig() {
  state.caseData = {};
  state.offenseId = config.offenses[0]?.id ?? "";
  state.selectedFactors = {};

  for (const field of config.case_form?.fields ?? []) {
    if (field.id !== "offense_id") state.caseData[field.id] = "";
  }

  for (const factor of config.factors) {
    state.selectedFactors[factor.id] = factor.options?.[0]?.id ?? "";
  }
}

function renderApp() {
  renderCaseFields();
  renderOffenseSelector();
  renderFactorFields();
  renderFinalSanctionOptions();
  document.querySelector("#config-status").textContent = `Configuración cargada: ${config.app_name ?? "sin nombre"} v${config.version ?? "s/v"}.`;
}

function renderCaseFields() {
  const container = document.querySelector("#case-fields");
  container.innerHTML = "";

  for (const field of config.case_form?.fields ?? []) {
    if (field.id === "offense_id") continue;

    const wrapper = document.createElement("label");
    wrapper.textContent = `${field.label}${field.required ? " *" : ""}`;

    const input = field.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
    if (field.type !== "textarea") input.type = field.type ?? "text";
    input.id = `case-${field.id}`;
    input.required = Boolean(field.required);
    input.value = state.caseData[field.id] ?? "";
    input.addEventListener("input", () => {
      state.caseData[field.id] = input.value;
      calculateAndRender();
    });

    wrapper.append(input);
    container.append(wrapper);
  }
}

function renderOffenseSelector() {
  const container = document.querySelector("#offense-section");
  const field = config.case_form?.fields?.find((item) => item.id === "offense_id");

  const label = document.createElement("label");
  label.textContent = `${field?.label ?? "Tipo de falta"} *`;

  const select = document.createElement("select");
  select.id = "offense-id";
  for (const offense of config.offenses) {
    const option = document.createElement("option");
    option.value = offense.id;
    option.textContent = `${offense.id} - ${offense.name} (${offense.base_level}, base ${offense.base_score})`;
    select.append(option);
  }
  select.value = state.offenseId;
  select.addEventListener("change", () => {
    state.offenseId = select.value;
    calculateAndRender();
  });

  const notes = document.createElement("p");
  notes.className = "field-note";
  notes.id = "offense-notes";

  label.append(select);
  container.replaceChildren(label, notes);
}

function renderFactorFields() {
  const container = document.querySelector("#factor-fields");
  container.innerHTML = "";

  for (const factor of config.factors) {
    const wrapper = document.createElement("div");
    wrapper.className = "factor-row";

    const label = document.createElement("label");
    label.textContent = factor.name;

    const definition = document.createElement("p");
    definition.className = "factor-definition";
    definition.textContent = factor.definition ?? "";

    const purpose = document.createElement("p");
    purpose.className = "field-note";
    purpose.textContent = factor.purpose ?? "";

    const select = document.createElement("select");
    select.id = `factor-${factor.id}`;
    select.dataset.factorId = factor.id;

    for (const item of factor.options ?? []) {
      const option = document.createElement("option");
      option.value = item.id;
      const scoreText = factor.type === "modifier" ? ` (${formatScore(item.score)})` : " (regla)";
      option.textContent = `${item.label}${scoreText}`;
      select.append(option);
    }

    select.value = state.selectedFactors[factor.id] ?? "";
    select.addEventListener("change", () => {
      state.selectedFactors[factor.id] = select.value;
      updateSelectedOptionDescription(factor.id);
      calculateAndRender();
    });

    const selectedDescription = document.createElement("p");
    selectedDescription.className = "option-description";
    selectedDescription.id = `option-description-${factor.id}`;

    const typeNote = document.createElement("p");
    typeNote.className = "field-note";
    typeNote.textContent = factor.type === "modifier" ? "Modifica el puntaje." : "No suma puntaje; alimenta reglas automáticas.";

    wrapper.append(label, definition, purpose, select, selectedDescription, typeNote);
    container.append(wrapper);
    updateSelectedOptionDescription(factor.id);
  }
}

function updateSelectedOptionDescription(factorId) {
  const factor = config.factors.find((item) => item.id === factorId);
  const option = getOption(config, factorId, state.selectedFactors[factorId]);
  const description = document.querySelector(`#option-description-${CSS.escape(factorId)}`);
  if (!description || !factor || !option) return;

  const scoreText = factor.type === "modifier" ? `Puntaje ${formatScore(option.score)}.` : "No suma puntaje.";
  description.textContent = `${scoreText} ${option.description ?? ""}`.trim();
}

function calculateAndRender() {
  if (!config) return;

  syncInputsFromState();
  const errors = validateCase();

  if (errors.length > 0) {
    document.querySelector("#validation-errors").innerHTML = errors.map((error) => `<p>${escapeHtml(error)}</p>`).join("");
  } else {
    document.querySelector("#validation-errors").innerHTML = "";
  }

  try {
    const calculation = calculateScore(config, state.offenseId, state.selectedFactors);
    const scoreRange = determineRange(config, calculation.totalScore);
    const ruleResult = evaluateRules(config, state.offenseId, state.selectedFactors);
    const recommendation = buildRecommendation(config, calculation, scoreRange, ruleResult);

    currentResult = buildOutput(calculation, scoreRange, ruleResult, recommendation, errors);
    renderResult(currentResult);
  } catch (error) {
    document.querySelector("#validation-errors").innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

function syncInputsFromState() {
  const offenseSelect = document.querySelector("#offense-id");
  if (offenseSelect) offenseSelect.value = state.offenseId;

  for (const [fieldId, value] of Object.entries(state.caseData)) {
    const input = document.querySelector(`#case-${CSS.escape(fieldId)}`);
    if (input && input.value !== value) input.value = value;
  }

  for (const [factorId, optionId] of Object.entries(state.selectedFactors)) {
    const select = document.querySelector(`#factor-${CSS.escape(factorId)}`);
    if (select && select.value !== optionId) select.value = optionId;
    updateSelectedOptionDescription(factorId);
  }
}

function validateCase() {
  const errors = [];
  for (const field of config.case_form?.fields ?? []) {
    if (field.id === "offense_id") continue;
    if (field.required && !String(state.caseData[field.id] ?? "").trim()) {
      errors.push(`Falta completar: ${field.label}.`);
    }
  }
  if (!state.offenseId) errors.push("Debe seleccionar una falta.");

  for (const factor of config.factors) {
    if (!state.selectedFactors[factor.id]) errors.push(`Debe seleccionar una opción para: ${factor.name}.`);
  }

  return errors;
}

function buildOutput(calculation, scoreRange, ruleResult, recommendation, validationErrors) {
  const selectedFactors = config.factors.map((factor) => {
    const option = getOption(config, factor.id, state.selectedFactors[factor.id]);
    return {
      factor_id: factor.id,
      factor_name: factor.name,
      factor_type: factor.type,
      factor_definition: factor.definition ?? "",
      factor_purpose: factor.purpose ?? "",
      option_id: option?.id ?? null,
      option_label: option?.label ?? null,
      option_description: option?.description ?? "",
      score: factor.type === "modifier" ? Number(option?.score ?? 0) : 0
    };
  });

  return {
    case_data: { ...state.caseData, offense_id: state.offenseId },
    selected_offense: calculation.offense,
    base_score: calculation.baseScore,
    modifier_sum: calculation.modifierSum,
    selected_factors: selectedFactors,
    total_score: calculation.totalScore,
    score_range: scoreRange,
    recommended_sanctions: recommendation.recommended_sanctions,
    alternative_sanctions: recommendation.alternative_sanctions,
    blocked_sanctions: recommendation.blocked_sanctions,
    automatic_rules_triggered: ruleResult.triggeredRules,
    forced_sanctions: ruleResult.forcedSanctionIds,
    forced_one_of_groups: ruleResult.forcedOneOfGroups,
    blocked_sanction_ids: ruleResult.blockedSanctionIds,
    conflicting_sanction_ids: ruleResult.conflictingSanctionIds,
    review_required: ruleResult.reviewRequired,
    require_non_formative_sanction: ruleResult.requireNonFormativeSanction,
    warnings: recommendation.warnings,
    validation_errors: validationErrors,
    justification: recommendation.justification,
    human_final_decision: getHumanFinalDecision()
  };
}

function renderResult(result) {
  const offenseNotes = document.querySelector("#offense-notes");
  offenseNotes.textContent = result.selected_offense.notes ?? "";

  document.querySelector("#score-output").innerHTML = `
    <div class="score-board">
      <div class="metric"><span>Puntaje base</span><strong>${result.base_score}</strong></div>
      <div class="metric"><span>Modificadores</span><strong>${formatScore(result.modifier_sum)}</strong></div>
      <div class="metric"><span>Total</span><strong>${result.total_score}</strong></div>
      <div class="metric"><span>Tramo</span><strong>${escapeHtml(result.score_range?.label ?? "Sin tramo")}</strong><small>${escapeHtml(result.score_range?.response_type ?? "")}</small></div>
    </div>
    ${result.warnings.map((warning) => `<p><span class="tag warning">${escapeHtml(warning)}</span></p>`).join("")}
  `;

  document.querySelector("#review-flag").classList.toggle("hidden", !result.review_required);
  document.querySelector("#justification-output").textContent = result.justification;
  renderSanctions(result);
  renderRules(result);
  renderDebug(result);
}

function renderSanctions(result) {
  const container = document.querySelector("#sanction-output");
  const allItems = [
    ...result.recommended_sanctions.map((sanction) => ({ ...sanction, section: "Sugerida" })),
    ...result.blocked_sanctions.map((sanction) => ({ ...sanction, section: "No disponible" }))
  ];

  container.innerHTML = allItems.map((sanction) => `
    <article class="sanction ${sanction.blocked ? "blocked" : ""}">
      <h3>${escapeHtml(sanction.name)}</h3>
      <p>${escapeHtml(sanction.description)}</p>
      <span class="tag">${escapeHtml(sanction.category)}</span>
      <span class="tag">${escapeHtml(sanction.section)}</span>
      ${sanction.mandatory ? '<span class="tag required">Obligatoria por regla</span>' : ""}
      ${sanction.blocked ? '<span class="tag blocked">Bloqueada por regla</span>' : ""}
      ${sanction.conflict ? '<span class="tag warning">Conflicto de reglas</span>' : ""}
    </article>
  `).join("") || "<p>No hay sanciones para mostrar.</p>";
}

function renderRules(result) {
  const container = document.querySelector("#rules-output");
  if (!container) return;
  if (result.automatic_rules_triggered.length === 0) {
    container.innerHTML = "<p>No se activaron reglas automáticas.</p>";
    return;
  }

  container.innerHTML = result.automatic_rules_triggered.map((rule) => `
    <div class="rule-row">
      <h3>${escapeHtml(rule.id)} - ${escapeHtml(rule.name)}</h3>
      <p><strong>Condición:</strong> ${escapeHtml(JSON.stringify(rule.if))}</p>
      <p><strong>Efecto:</strong> ${escapeHtml(JSON.stringify(rule.then))}</p>
    </div>
  `).join("");
}

function renderFinalSanctionOptions() {
  const select = document.querySelector("#final-sanctions");
  select.innerHTML = "";
  for (const sanction of config.sanctions) {
    const option = document.createElement("option");
    option.value = sanction.id;
    option.textContent = `${sanction.id} - ${sanction.name}`;
    select.append(option);
  }

  select.addEventListener("change", calculateAndRender);
  document.querySelector("#final-decision").addEventListener("input", calculateAndRender);
  document.querySelector("#final-observations").addEventListener("input", calculateAndRender);
}

function renderDebug(result) {
  const container = document.querySelector("#debug-output");
  if (!container) return;
  const debug = {
    puntaje_base: result.base_score,
    suma_modificadores: result.modifier_sum,
    reglas_activadas: result.automatic_rules_triggered.map((rule) => rule.id),
    sanciones_bloqueadas: result.blocked_sanction_ids,
    sanciones_forzadas: result.forced_sanctions,
    conflictos: result.conflicting_sanction_ids
  };
  container.textContent = JSON.stringify(debug, null, 2);
}

function loadExampleCase() {
  state.caseData = { ...state.caseData, ...exampleCase.caseData };
  state.offenseId = exampleCase.offenseId;
  state.selectedFactors = { ...state.selectedFactors, ...exampleCase.selectedFactors };
}

async function handleConfigUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const uploadedConfig = JSON.parse(await file.text());
    validateConfig(uploadedConfig);
    config = uploadedConfig;
    initializeStateFromConfig();
    renderApp();
    calculateAndRender();
    document.querySelector("#config-status").textContent = `Configuración externa cargada: ${file.name}.`;
  } catch (error) {
    document.querySelector("#config-status").textContent = `No se pudo cargar el JSON: ${error.message}`;
  }
}

function getHumanFinalDecision() {
  const selectedSanctions = [...(document.querySelector("#final-sanctions")?.selectedOptions ?? [])].map((option) => option.value);
  return {
    decision: document.querySelector("#final-decision")?.value ?? "",
    applied_sanction_ids: selectedSanctions,
    observations: document.querySelector("#final-observations")?.value ?? ""
  };
}

function exportResultPdf() {
  if (!currentResult) return;
  currentResult.human_final_decision = getHumanFinalDecision();

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("No se pudo abrir la ventana de impresión. Revise si el navegador bloqueó ventanas emergentes.");
    return;
  }

  printWindow.document.write(buildPdfDocument(currentResult));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function buildPdfDocument(result) {
  const selectedFactors = result.selected_factors.map((factor) => `
    <tr>
      <td>${escapeHtml(factor.factor_name)}</td>
      <td>${escapeHtml(factor.option_label ?? "")}</td>
      <td>${factor.factor_type === "modifier" ? formatScore(factor.score) : "No suma"}</td>
    </tr>
  `).join("");

  const recommendedSanctions = result.recommended_sanctions.map((sanction) => `
    <li>${escapeHtml(sanction.name)}${sanction.mandatory ? " (obligatoria por regla)" : ""}</li>
  `).join("") || "<li>No hay sanciones sugeridas disponibles.</li>";

  const blockedSanctions = result.blocked_sanctions.map((sanction) => `
    <li>${escapeHtml(sanction.name)}</li>
  `).join("") || "<li>No hay sanciones bloqueadas.</li>";

  const finalDecision = result.human_final_decision;
  const appliedSanctions = finalDecision.applied_sanction_ids.length
    ? finalDecision.applied_sanction_ids.join(", ")
    : "Sin sanciones seleccionadas.";

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>Resultado del caso</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; color: #202124; line-height: 1.45; margin: 32px; }
        h1 { font-size: 22px; margin-bottom: 6px; }
        h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 1px solid #d7dce0; padding-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #d7dce0; padding: 8px; text-align: left; vertical-align: top; }
        .notice { background: #fff7ed; border-left: 4px solid #b45309; padding: 10px; }
      </style>
    </head>
    <body>
      <h1>Resultado del caso de integridad académica</h1>
      <p class="notice">Esta recomendación es orientativa. No reemplaza la revisión humana ni la normativa institucional aplicable.</p>

      <h2>Datos del caso</h2>
      <table>
        <tr><th>ID del caso</th><td>${escapeHtml(result.case_data.case_id ?? "")}</td></tr>
        <tr><th>Fecha</th><td>${escapeHtml(result.case_data.date ?? "")}</td></tr>
        <tr><th>Curso o asignatura</th><td>${escapeHtml(result.case_data.course ?? "")}</td></tr>
        <tr><th>Docente que reporta</th><td>${escapeHtml(result.case_data.reporting_teacher ?? "")}</td></tr>
        <tr><th>Estudiante</th><td>${escapeHtml(result.case_data.student_name ?? "")}</td></tr>
        <tr><th>Descripción</th><td>${escapeHtml(result.case_data.description ?? "")}</td></tr>
      </table>

      <h2>Cálculo</h2>
      <table>
        <tr><th>Falta</th><td>${escapeHtml(result.selected_offense.name)}</td></tr>
        <tr><th>Puntaje base</th><td>${result.base_score}</td></tr>
        <tr><th>Suma de modificadores</th><td>${formatScore(result.modifier_sum)}</td></tr>
        <tr><th>Puntaje total</th><td>${result.total_score}</td></tr>
        <tr><th>Tramo</th><td>${escapeHtml(result.score_range?.label ?? "Sin tramo")}</td></tr>
      </table>

      <h2>Factores</h2>
      <table>
        <tr><th>Factor</th><th>Opción</th><th>Puntaje</th></tr>
        ${selectedFactors}
      </table>

      <h2>Sanciones sugeridas</h2>
      <ul>${recommendedSanctions}</ul>

      <h2>Sanciones no disponibles</h2>
      <ul>${blockedSanctions}</ul>

      <h2>Revisión requerida</h2>
      <p>${result.review_required ? "Sí" : "No"}</p>

      <h2>Justificación</h2>
      <p>${escapeHtml(result.justification)}</p>

      <h2>Decisión final</h2>
      <p><strong>Decisión:</strong> ${escapeHtml(finalDecision.decision || "Sin registrar.")}</p>
      <p><strong>Sanciones aplicadas:</strong> ${escapeHtml(appliedSanctions)}</p>
      <p><strong>Observaciones:</strong> ${escapeHtml(finalDecision.observations || "Sin observaciones.")}</p>
    </body>
  </html>`;
}

function formatScore(score) {
  const number = Number(score ?? 0);
  return number > 0 ? `+${number}` : String(number);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
