# Fase 1 · Entrega 1A — Diseño, acceso y panel

> **Estado:** lista para que la revises. La Entrega 1B empieza cuando la apruebes.
> Respuesta a la Fase 0: «Sí». La tomé como **aceptación de todas las recomendaciones** del [plan](fase-0-plan.md#2-preguntas-antes-de-seguir). Si alguna no era así, dímelo y la cambio.

## Qué hay

| Parte | Qué hace |
|---|---|
| **Ingreso** | Celular y contraseña. Errores en palabras simples. Si a alguien le quitan el acceso, no puede volver a entrar. |
| **Varios talleres** | Selector arriba a la izquierda. Cada taller tiene su personal, su configuración y sus datos. |
| **Roles con permisos en la base de datos** | Los 7 roles de la especificación. La base de datos decide qué ve y qué cambia cada uno (RLS), no solo la pantalla. |
| **Personal y roles** (gerencia y administración) | Agregar personas, darles uno o varios roles, asignarles contraseña nueva, quitar o devolver el acceso. Administración no puede dar ni quitar el rol de gerencia. Un taller nunca se queda sin gerencia. |
| **Configuración del taller** (gerencia y administración) | Datos del taller (RUC validado), reglas (tolerancia de citas, garantía, alertas, IGV, horarios), meta de ventas del mes, lo que ve administración (solo gerencia) y agregar un taller. |
| **Panel principal** | Saludo con la hora de Lima, la cifra del día, tarjeta destacada, indicadores con variación, gráfico de ventas contra costos, meta del mes, carros por atender y actividad reciente con buscador, filtro, casillas y menú por fila. **Cada rol ve su propio panel.** |
| **Modo claro y oscuro** | Interruptor en la barra lateral (en celular, en "Más"). |
| **Celular primero** | En pantallas chicas la barra lateral pasa abajo, las pestañas se deslizan y las tablas se vuelven listas. Botones de 48 px. |
| **Auditoría** | Cada cambio en empresas, personal, roles, configuración y metas queda registrado con quién, cuándo, antes y después. Nadie puede borrarlo. |

**Importante:** los carros, órdenes, citas y montos del panel son **datos de ejemplo** y así lo dice la pantalla. Los carros y citas reales llegan en la Entrega 1B; los montos reales, en la Fase 3.

## Cómo probarlo tú mismo

1. Sigue el [README](../README.md) (opción A con Docker Desktop, u opción B con un proyecto gratis de Supabase).
2. Entra con cada persona de ejemplo (contraseña `taller-ejemplo`) y revisa que vea lo que corresponde:

| Entra con | Debe ver | No debe ver |
|---|---|---|
| 900 000 001 · Gerencia | Todo: utilidad, gráfico, Personal y roles, Configuración, Reportes | — |
| 900 000 002 · Administración | Ventas, compras, entregados, meta, Personal y Configuración | Utilidad y gráfico (hasta que gerencia lo active en Configuración); la opción de dar el rol Gerencia |
| 900 000 003 · Asesor | Carros, ventas, meta con ritmo diario, por atender, actividad con montos | Utilidad, Personal, Configuración |
| 900 000 004 · Técnico | Sus trabajos | Precios, montos, clientes |
| 900 000 005 · Almacén | Compras, carros que esperan repuesto | Ventas, montos de la actividad, clientes |
| 900 000 006 · Ventas por redes | Citas de hoy, botón Agendar cita | Costos |
| 900 000 007 · Confirmación | Citas de hoy, botón Confirmar citas | Costos |

3. Con gerencia: agrega una persona en **Personal y roles**, entra con ella en otra ventana, quítale el acceso y comprueba que ya no puede entrar.
4. En el celular: abre la dirección de tu PC desde el navegador (misma red Wi-Fi) y revisa el panel y la barra inferior.

## Pruebas automáticas (todas pasan)

- `npm test`: **46 pruebas** de celulares, placas, soles, hora de Lima, qué ve cada rol en el panel y en la navegación, y que los datos de ejemplo cuadren.
- `npm run test:db`: **31 pruebas** de permisos dentro de la base de datos. Por ejemplo: un técnico no ve otro taller, administración no puede dar el rol de gerencia, nadie cambia su propio celular ni se desactiva a sí mismo, la auditoría no se borra y una persona desactivada pierde el acceso al instante.
- Pruebas en el navegador: ingreso con contraseña equivocada, agregar persona, que la persona nueva entre, configuración con RUC inválido, quitar acceso.
- Capturas revisadas en celular (390 px) y computadora (1440 px): en modo claro para cada rol, y en modo oscuro para gerencia y técnico. Sin desbordes horizontales.

Las pruebas encontraron y corrigieron dos errores reales antes de entregar: un técnico podía crear talleres, y un celular peruano mal escrito se aceptaba como si fuera extranjero.

## Decisiones que tomé (dímelo si quieres otra cosa)

1. **Texto negro sobre la tarjeta naranja.** El blanco sobre ese naranja no se lee bien a la luz del taller (contraste 3,4:1); el negro da 5:1.
2. **Compras en gris en su variación.** Que suban las ventas o la utilidad es bueno (verde) y que bajen es malo (rojo). Que suban las compras no es ni bueno ni malo, así que va en gris.
3. **La variación compara contra el mes anterior hasta el mismo día** (por ejemplo, del 1 al 15 de noviembre contra el 1 al 15 de octubre). Comparar un mes a medias con uno completo siempre daría "baja".
4. **Estados de la orden en la tabla:** gris "En taller" (sin empezar), amarillo "En proceso", rojo "Espera repuesto" (lo único que es un problema), verde "Listo" y "Entregado".
5. **El buscador de arriba y los avisos** se muestran, pero explican que funcionan desde la Entrega 1B y la Fase 2.
6. **Los botones que llevan a pantallas futuras** abren una página que dice qué hará y en qué entrega llega.
7. **Las piezas de shadcn/ui están escritas a mano** con la misma estructura, porque su sitio está bloqueado desde el entorno donde trabajo. Funcionan igual.
8. **Variables de entorno sin `NEXT_PUBLIC_`.** Así la misma imagen de Docker sirve para pruebas y producción; las claves se ponen en EasyPanel.

## Lo que viene en la Entrega 1B

Clientes y vehículos, nuevo ingreso en pocos toques con fotos, órdenes con estados, historial por placa y reingreso por garantía, citas de redes con unión automática, app instalable (PWA) y la guía de despliegue en EasyPanel completa.
