export function validateConfig(config) {
  const requiredArrays = ["score_ranges", "offenses", "factors", "sanctions", "automatic_rules"];
  const missing = requiredArrays.filter((key) => !Array.isArray(config?.[key]));
  if (missing.length > 0) {
    throw new Error(`Configuración inválida. Faltan arreglos: ${missing.join(", ")}.`);
  }
}

export function getOption(config, factorId, optionId) {
  const factor = config.factors.find((item) => item.id === factorId);
  return factor?.options?.find((option) => option.id === optionId) ?? null;
}

export function calculateScore(config, offenseId, selectedFactors) {
  const offense = config.offenses.find((item) => item.id === offenseId);
  if (!offense) {
    throw new Error("Debe seleccionar una falta válida.");
  }

  const modifierDetails = config.factors
    .filter((factor) => factor.type === "modifier")
    .map((factor) => {
      const option = getOption(config, factor.id, selectedFactors[factor.id]);
      return {
        factor_id: factor.id,
        factor_name: factor.name,
        option_id: option?.id ?? null,
        option_label: option?.label ?? "Sin selección",
        score: Number(option?.score ?? 0)
      };
    });

  const modifierSum = modifierDetails.reduce((sum, item) => sum + item.score, 0);

  return {
    offense,
    baseScore: Number(offense.base_score ?? 0),
    modifierSum,
    modifierDetails,
    totalScore: Number(offense.base_score ?? 0) + modifierSum
  };
}

export function determineRange(config, totalScore) {
  return config.score_ranges.find((range) => totalScore >= range.min && totalScore <= range.max) ?? null;
}

function conditionMatches(ruleCondition, offenseId, selectedFactors) {
  if (ruleCondition.offense_ids && !ruleCondition.offense_ids.includes(offenseId)) {
    return false;
  }

  if (ruleCondition.factor) {
    const selectedOptionId = selectedFactors[ruleCondition.factor];
    if (!ruleCondition.option_ids?.includes(selectedOptionId)) {
      return false;
    }
  }

  if (ruleCondition.any_confirmed_case && !offenseId) {
    return false;
  }

  return true;
}

export function evaluateRules(config, offenseId, selectedFactors) {
  const triggeredRules = [];
  const forcedSanctionIds = new Set();
  const blockedSanctionIds = new Set();
  const forcedOneOfGroups = [];
  let reviewRequired = false;
  let requireNonFormativeSanction = false;

  for (const rule of config.automatic_rules) {
    if (!conditionMatches(rule.if ?? {}, offenseId, selectedFactors)) continue;

    triggeredRules.push(rule);
    const effect = rule.then ?? {};

    for (const sanctionId of effect.force_include_sanctions ?? []) {
      forcedSanctionIds.add(sanctionId);
    }

    if (effect.force_include_one_of?.length) {
      forcedOneOfGroups.push(effect.force_include_one_of);
    }

    for (const sanctionId of effect.block_sanctions ?? []) {
      blockedSanctionIds.add(sanctionId);
    }

    reviewRequired = reviewRequired || Boolean(effect.set_review_required);
    requireNonFormativeSanction = requireNonFormativeSanction || Boolean(effect.require_non_formative_sanction);
  }

  const conflictingSanctionIds = [...forcedSanctionIds].filter((id) => blockedSanctionIds.has(id));
  if (conflictingSanctionIds.length > 0) {
    reviewRequired = true;
  }

  return {
    triggeredRules,
    forcedSanctionIds: [...forcedSanctionIds],
    blockedSanctionIds: [...blockedSanctionIds],
    forcedOneOfGroups,
    conflictingSanctionIds,
    reviewRequired,
    requireNonFormativeSanction
  };
}

export function buildRecommendation(config, calculation, scoreRange, ruleResult) {
  const sanctionById = new Map(config.sanctions.map((sanction) => [sanction.id, sanction]));
  const blocked = new Set(ruleResult.blockedSanctionIds);
  const forced = new Set(ruleResult.forcedSanctionIds);

  const scoreCompatible = config.sanctions.filter(
    (sanction) => calculation.totalScore >= sanction.score_min && calculation.totalScore <= sanction.score_max
  );

  const recommendedIds = new Set();
  for (const sanction of scoreCompatible) {
    if (!blocked.has(sanction.id)) recommendedIds.add(sanction.id);
  }

  for (const sanctionId of forced) {
    if (!blocked.has(sanctionId)) recommendedIds.add(sanctionId);
  }

  for (const group of ruleResult.forcedOneOfGroups) {
    const availableChoice = group.find((sanctionId) => !blocked.has(sanctionId));
    if (availableChoice) recommendedIds.add(availableChoice);
  }

  const recommendedSanctions = [...recommendedIds]
    .map((id) => decorateSanction(sanctionById.get(id), ruleResult))
    .filter(Boolean);

  const blockedSanctions = ruleResult.blockedSanctionIds
    .map((id) => decorateSanction(sanctionById.get(id), ruleResult))
    .filter(Boolean);

  const alternativeSanctions = config.sanctions
    .filter((sanction) => !recommendedIds.has(sanction.id) && !blocked.has(sanction.id))
    .map((sanction) => decorateSanction(sanction, ruleResult));

  const nonFormativeIncluded = recommendedSanctions.some((sanction) => sanction.category !== "Formativa");
  const warnings = [];
  if (ruleResult.requireNonFormativeSanction && !nonFormativeIncluded) {
    warnings.push("Una regla exige incluir al menos una sanción no formativa; revise la decisión final.");
  }
  if (ruleResult.conflictingSanctionIds.length > 0) {
    warnings.push("Hay sanciones simultáneamente forzadas y bloqueadas por reglas distintas; requiere revisión humana.");
  }

  return {
    score_range: scoreRange,
    recommended_sanctions: recommendedSanctions,
    alternative_sanctions: alternativeSanctions,
    blocked_sanctions: blockedSanctions,
    warnings,
    justification: buildJustification(config, calculation, scoreRange, ruleResult, recommendedSanctions)
  };
}

function decorateSanction(sanction, ruleResult) {
  if (!sanction) return null;
  return {
    ...sanction,
    mandatory: ruleResult.forcedSanctionIds.includes(sanction.id),
    blocked: ruleResult.blockedSanctionIds.includes(sanction.id),
    conflict: ruleResult.conflictingSanctionIds.includes(sanction.id)
  };
}

function buildJustification(config, calculation, scoreRange, ruleResult, recommendedSanctions) {
  const ruleNames = ruleResult.triggeredRules.map((rule) => rule.name).join("; ") || "no se activaron reglas automáticas";
  const sanctionNames = recommendedSanctions.map((sanction) => sanction.name).join(", ") || "no hay sanciones disponibles";

  return [
    config.output?.justification_template,
    `Falta seleccionada: ${calculation.offense.name} (${calculation.offense.base_level}), puntaje base ${calculation.baseScore}.`,
    `Modificadores: ${calculation.modifierSum >= 0 ? "+" : ""}${calculation.modifierSum}. Puntaje total: ${calculation.totalScore}.`,
    `Tramo: ${scoreRange?.label ?? "sin tramo"}${scoreRange ? `, respuesta orientativa: ${scoreRange.response_type}` : ""}.`,
    `Reglas: ${ruleNames}.`,
    `Sanciones orientativas disponibles: ${sanctionNames}.`
  ].filter(Boolean).join(" ")
}
