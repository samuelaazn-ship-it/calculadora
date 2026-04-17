# Matriz de apoyo para integridad académica

Aplicación web local para registrar un caso, seleccionar una falta, valorar factores, calcular puntaje, activar reglas automáticas y exportar el resultado en JSON.

La recomendación es solo orientativa. La decisión final debe quedar registrada por una persona o instancia competente.

## Estructura

- `index.html`: interfaz principal.
- `config/default-config.json`: matriz de configuración por defecto.
- `src/logic.js`: funciones puras de cálculo, tramo, reglas y recomendación.
- `src/app.js`: render de la interfaz, estado del formulario, carga interna de la configuración y exportación.
- `src/styles.css`: estilos simples.

## Cómo ejecutar

Desde esta carpeta:

```powershell
py -m http.server 8000
```

Luego abra:

```text
http://localhost:8000
```

Se recomienda usar servidor local porque el navegador puede bloquear la carga de `config/default-config.json` si se abre `index.html` directamente como archivo.

## Ajustes de configuración

- Se eliminaron los factores `magnitude` y `conduct_complexity`.
- `training_stage` fue reemplazado por `student_year`.
- `academic_impact` usa las opciones `Leve`, `Moderado`, `Grave` y `Muy grave`, con puntajes `0`, `8`, `15` y `25`.
- Cada factor incluye `definition`, `purpose` y descripciones en sus opciones.
- `evidence_strength` y `critical_context` siguen como `rule_input`: no suman puntaje y alimentan reglas automáticas.

## Decisiones conservadoras sobre ambigüedades

- El JSON no define prioridad entre reglas. Si una regla fuerza una sanción y otra la bloquea, la app conserva ambas marcas, la muestra como conflicto y activa revisión requerida.
- `force_include_one_of` se interpreta como obligación de incluir al menos una sanción del grupo. La app selecciona la primera disponible no bloqueada para la recomendación orientativa.
- Los factores `rule_input` no suman puntaje aunque sus opciones tengan `score`; solo alimentan reglas.
- Las sanciones forzadas por reglas se agregan a la recomendación aunque estén fuera del rango de puntaje, salvo que estén bloqueadas por otra regla.
