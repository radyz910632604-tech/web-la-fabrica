# Product

<!-- impeccable:product-schema 1 -->

> Fuente: `ESPECIFICACION.md` (escrita por el dueño del proyecto) y sus respuestas de la Fase 0. No se agregó nada que no esté ahí.

## Platform

web

## Users

Personal de talleres automotrices en Lima, Perú, con poca experiencia en sistemas: gerencia, administrador, asesor de servicio, técnicos, almacén, vendedores de redes y confirmador de citas. Usan sobre todo el celular, dentro del taller, con las manos ocupadas; gerencia y administración también usan computadora.

## Product Purpose

Controlar el taller de punta a punta: qué carros hay, en qué estado, qué se compró y vendió para cada uno, quién cobró, cuánto se ganó y qué no cuadra. Éxito = que todo se registre con un toque, una foto o un audio, y que gerencia vea la utilidad real sin perseguir a nadie.

## Positioning

Una sola base de datos alimentada por la app y por WhatsApp: el personal registra hablando o mandando una foto, y nada queda definitivo hasta que una persona confirma.

## Operating Context

- Talleres de transmisiones, GNV/GLP, aire acondicionado, frenos y cambios de aceite. Varios talleres (empresas) en el mismo sistema.
- La placa peruana es el identificador del carro; el celular, el del cliente y el del personal.
- Comprobantes SUNAT (boletas y facturas), IGV 18 % configurable, soles (S/), hora de Lima.
- Pagos por efectivo, Yape, Plin, tarjeta y transferencia.

## Capabilities and Constraints

- Stack fijado: Next.js + TypeScript + Tailwind + shadcn/ui, Supabase con RLS, n8n, PWA, Docker en EasyPanel.
- Permisos por rol aplicados en la base de datos.
- Montos leídos por IA quedan "por confirmar". El dinero no se borra: se anula con motivo.
- Sin datos reales de clientes ni claves en el repositorio.

## Brand Commitments

- Nombre provisional "Taller Control" con logo simple propio. No copiar marcas existentes.
- Estilo fijado en la sección 3 de la especificación: fondo gris claro (#EDEDED), tarjetas blancas de esquinas muy redondeadas (20-24 px) con sombra casi imperceptible, tarjetas internas #F5F5F5, acento naranja rojizo (#F2542D) con degradado suave solo en la tarjeta destacada, negro (#1A1A1A) para botón principal, pestaña activa y serie secundaria de gráficos. Pestañas píldora arriba, barra de íconos a la izquierda (abajo en celular), Inter, botones píldora, modo claro y oscuro.
- Referencia visual entregada por el dueño: un panel financiero (imagen, no se versiona). Se toma su estructura, no su marca.

## Evidence on Hand

- No hay datos reales todavía. Todo dato mostrado antes de la Fase 3 es de ejemplo y se marca como tal.
- No hay fotos propias, logo ni nombre definitivo.

## Product Principles

1. Un toque, una foto o un audio: si algo necesita más, se rediseña.
2. Nada definitivo sin una persona que confirme.
3. Cada rol ve solo lo suyo, y la base de datos lo hace cumplir.
4. El dinero se explica: cada cifra se puede rastrear a sus registros.

## Accessibility & Inclusion

Botones de al menos 48 px de alto. Textos en español sencillo. Celular primero.
