# Manual de Usuario — Kairos / Jornada Laboral

Herramienta para registrar, validar y reportar las horas laborales de los equipos
(Colombia, Ley 2466/2025). Parte del hub **Producto Deportivas / NOSTRA**.

---

## 1. Perfiles (roles)

| Rol | Qué puede hacer |
|---|---|
| **Talento Humano (TH)** | Ve todo. Da/quita accesos, ajusta nómina, configura períodos, revisa y aprueba lo que envían las áreas, integra Buk. |
| **Líder** | Su equipo: revisa lo cargado, lo valida y lo envía a TH; activa registradores; comenta en el chat. |
| **Registrador** | Carga los horarios de su equipo y los envía a validación del líder. |

## 2. Primer ingreso (crear tu contraseña)

1. Recibes un **enlace** de Talento Humano o de tu líder (algo como `.../?onboarding=xxxx`).
2. Ábrelo: verás **"Hola, [tu nombre] — Crea tu contraseña"**.
3. Escribe tu contraseña (mínimo 8 caracteres), repítela y **"Crear contraseña y entrar"**.
4. Quedas dentro. La próxima vez ingresas con tu **correo + contraseña** (botón "Iniciar
   sesión con contraseña"). Solo funcionan correos **@virtualsoft.tech**.

> El enlace es de **un solo uso** y vence en 7 días. Si expira, pídele a TH que lo regenere.

## 3. Registrar horario (registrador / líder)

- Entra a **Registrar horario**. Marca a los empleados y pulsa **Cargar horario** para
  asignarles turnos por días (o abre a cada uno para ajustarlo día a día).
- Puedes cargar **sábados y domingos**: márcalos en el selector de días; el sistema paga
  el recargo dominical/festivo correcto.
- Turnos que cruzan medianoche se parten solos (base + "cola" del día siguiente).
- **Almuerzo**: la grilla muestra las horas realmente trabajadas (descuenta el almuerzo);
  los recargos se pagan completos.
- Marca **Descanso (D)**, licencias o novedades desde el editor del día.

## 4. Consolidado y chat (validación)

- **Registrador**: revisa lo cargado y **Enviar a validación del líder**.
- **Líder**: **Validar como líder** y luego **Enviar a Talento Humano**.
- **TH**: entra a cada área, revisa la grilla, **aprueba** o **devuelve** con un comentario.
- El **chat** por área deja la conversación y los eventos (validaciones, ajustes, etc.).

## 5. Ajustes de nómina (solo TH)

Cuando un equipo reportó algo mal y se dan cuenta después: **Configuración › Ajustes de
nómina**.
1. Elige **período**, **empleado**, **tipo de hora** (ej. Nocturno + dominical) y si
   **descuentas** o **agregas**, las **horas** y el **motivo** (obligatorio).
2. **Guardar ajuste**.

- **No cambia la grilla** de lo que reportó el equipo (queda intacta).
- El **reporte a Financiera** y el resumen ya salen con el ajuste aplicado.
- Queda una **nota automática en Consolidado y chat** del área (para que quede claro qué se
  ajustó, a quién y por qué → trazabilidad). Puedes **anular** un ajuste desde la misma lista.

## 6. Accesos (TH y líderes)

- **TH**: Configuración › **Accesos**. Da acceso a alguien del listado o a alguien nuevo
  por correo (ej. otro miembro de TH). Genera el **enlace** para compartir; puedes
  **restablecer** (nuevo enlace) o **revocar**.
- **Líder**: en **Mi equipo**, pulsa **Activar** a quien deba registrar → se le genera el
  acceso y se **copia el enlace** para que lo compartas. La columna "Acceso" muestra el
  estado (Con acceso / Pendiente · copiar enlace).

## 7. Integración con Buk (solo TH)

Configuración › **Integración Buk**. Si el token ya está puesto en el servidor:
- **Probar conexión**: muestra una muestra de lo que trae Buk.
- **Sincronizar ahora**: trae los colaboradores activos y actualiza/crea empleados.
- Si está activado el sync automático, se actualiza solo cada cierto tiempo (cuando entra
  alguien nuevo a Buk aparece solo). Los que no tengan área mapeada se listan para decidir.

## 8. Otras secciones

- **Calendario**: pagos, cortes a TH, reporte a Financiera, primas y festivos.
- **Referencia legal**: recargos, extras y cambios normativos vigentes.
- **Reporte de horas**: el entregable por categoría (ordinaria, nocturna, dominical,
  extra…), ya con los ajustes de TH aplicados.

## 9. Preguntas frecuentes

- **No me deja entrar con mi correo** → verifica que sea `@virtualsoft.tech` y que ya
  creaste tu contraseña con el enlace. Si nunca lo hiciste, pide el enlace a TH/tu líder.
- **Mi enlace no sirve** → es de un solo uso / vence en 7 días; pide que lo regeneren.
- **Reporté mal unas horas** → avísale a TH; ellos lo corrigen con un **Ajuste** (queda la
  nota en el chat), sin tener que reescribir la grilla.
