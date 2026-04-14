# 🧪 Testing Guide - EUDI-044 Implementation

Este documento proporciona una guía paso a paso para verificar que la implementación funciona correctamente.

---

## 🎯 Pre-requisitos

1. **Backend EBW** corriendo en modo servidor con los endpoints:
   - `POST /api/v1/auth/register`
   - `POST /api/v1/auth/verify-email`
   - `POST /api/v1/auth/refresh`
   - `POST /api/v1/auth/logout`
   - `POST /api/v1/auth/passkeys`
   - `GET /api/v1/auth/passkeys`
   - `PATCH /api/v1/auth/passkeys/{id}`
   - `DELETE /api/v1/auth/passkeys/{id}`
   - `POST /api/v1/auth/passkeys/{id}/revoke-sessions`

2. **Variables de entorno** configuradas:
   ```javascript
   // src/assets/env.js
   window.env = {
     server_url: "http://localhost:8083",
     wallet_mode: "server"  // ← IMPORTANTE
   };
   ```

3. **Navegador** con soporte para WebAuthn (Chrome, Edge, Safari)

---

## 🧪 Test Suite 1: Bug Fix - Re-autenticación Post-Logout

### Objetivo
Verificar que después de hacer logout, el usuario puede re-autenticarse con email sin crear un nuevo passkey.

### Pasos

#### 1.1 Setup Inicial
1. Abrir la aplicación en `http://localhost:4200`
2. Registrarse como nuevo usuario:
   - Email: `test@example.com`
   - Verificar OTP del email
   - Crear passkey cuando se solicite (usar PIN/biométrico)
3. Verificar que llegas a la pantalla de Home (`/tabs/home`)

#### 1.2 Hacer Logout
1. Ir a Settings
2. Click en "Logout"
3. Verificar redirección a `/auth/login`

#### 1.3 Intento de Login con Passkey
1. En `/auth/login`, click en "Sign in with Passkey"
2. Completar autenticación biométrica/PIN
3. **✅ Verificar**: Redirección automática a `/auth/register?reauth=true`
4. **✅ Verificar**: Título muestra "Welcome back" (no "Create account")
5. **✅ Verificar**: Subtítulo muestra "Verify your email to restore your session"

#### 1.4 Re-autenticación con Email
1. Introducir email: `test@example.com`
2. **✅ Verificar**: Barra de progreso muestra solo 2 pasos (Email y Verify)
3. Click "Send verification code"
4. Introducir OTP del email
5. Click "Verify"
6. **✅ Verificar**: NO se pide crear passkey (salta el paso 3)
7. **✅ Verificar**: Redirección directa a `/tabs/home`
8. **✅ Verificar**: Usuario está autenticado (puede navegar por la app)

#### 1.5 Verificar Estado de Sesión
1. Abrir DevTools → Application → Local Storage
2. **✅ Verificar**: Existe `wallet_refresh_token`
3. **✅ Verificar**: El token es diferente al anterior (rotación exitosa)

### ✅ Resultado Esperado
- Login funciona después de logout sin crear nuevo passkey
- Solo 2 pasos en re-autenticación (no 3)
- Sesión restaurada correctamente

---

## 🧪 Test Suite 2: Registro de Passkey en Servidor (US-005)

### Objetivo
Verificar que cuando se crea un passkey, los metadatos se registran en el backend.

### Pasos

#### 2.1 Registro de Nuevo Usuario
1. Abrir la app en modo incógnito o borrar datos
2. Ir a `/auth/register`
3. Introducir email: `newuser@example.com`
4. Verificar OTP
5. Crear passkey (paso 3)
6. **Monitorear DevTools → Network** durante la creación del passkey

#### 2.2 Verificar Llamada API
**✅ Verificar** que se hace `POST /api/v1/auth/passkeys` con:
```json
{
  "credentialId": "...",
  "displayName": "Chrome on Windows PC",  // o similar según tu navegador
  "userAgent": "Mozilla/5.0..."
}
```

#### 2.3 Verificar Respuesta del Servidor
**✅ Verificar** respuesta 201 Created con:
```json
{
  "id": "uuid-...",
  "credentialId": "...",
  "displayName": "Chrome on Windows PC",
  "createdAt": "2026-04-14T...",
  "lastUsedAt": null,
  "activeSessions": 1
}
```

### ✅ Resultado Esperado
- Passkey registrado en el servidor
- Display name auto-detectado correctamente

---

## 🧪 Test Suite 3: Gestión de Dispositivos (US-006 a US-010)

### Objetivo
Verificar todas las funcionalidades de la página de dispositivos.

### Pasos

#### 3.1 Acceder a My Devices
1. Estando autenticado, ir a Settings
2. **✅ Verificar**: Aparece item "My Devices" con icono de llave
3. Click en "My Devices"
4. **✅ Verificar**: Redirección a `/tabs/devices`

#### 3.2 Listar Dispositivos (US-006)
1. **✅ Verificar**: Se muestra lista de passkeys
2. **✅ Verificar**: Cada passkey muestra:
   - Nombre del dispositivo
   - Badge verde "1 session" (dispositivo actual)
   - Fecha de creación "Added Apr 14, 2026"
   - Botones: Renombrar (lápiz) y Eliminar (basura)

#### 3.3 Renombrar Passkey (US-008)
1. Click en botón de lápiz
2. **✅ Verificar**: Modal con título "Rename Passkey"
3. Cambiar nombre a "Mi Laptop Personal"
4. Click "Rename"
5. **✅ Verificar**: 
   - Llamada `PATCH /api/v1/auth/passkeys/{id}` con `{ "displayName": "Mi Laptop Personal" }`
   - Nombre actualizado en la lista sin recargar

#### 3.4 Registrar Segundo Dispositivo
1. Abrir la app en OTRO navegador/dispositivo (o modo incógnito)
2. Hacer login completo (email + OTP + passkey)
3. En el primer dispositivo, refrescar `/tabs/devices`
4. **✅ Verificar**: Ahora aparecen 2 passkeys en la lista

#### 3.5 Revocar Sesiones (US-009)
1. En el primer dispositivo, ver el segundo passkey
2. **✅ Verificar**: Botón "Close sessions on this device" visible
3. Click en "Close sessions on this device"
4. **✅ Verificar**:
   - Llamada `POST /api/v1/auth/passkeys/{id}/revoke-sessions`
   - Badge cambia a gris "No active sessions"
   - Botón "Close sessions" desaparece

#### 3.6 Verificar Sesión Revocada
1. En el segundo dispositivo, intentar navegar
2. **✅ Verificar**: Sesión expirada, redirige a login
3. **✅ Verificar**: Usuario puede re-autenticarse con email (US-002 AC-002.6)

#### 3.7 Eliminar Passkey - Error Última Passkey (US-007 AC-007.4)
1. En el primer dispositivo, eliminar el segundo passkey
2. Intentar eliminar el primer passkey (único restante)
3. Click en botón de basura
4. Click "Delete" en confirmación
5. **✅ Verificar**:
   - Llamada `DELETE /api/v1/auth/passkeys/{id}` retorna 409 Conflict
   - Modal de error: "Cannot delete the last registered passkey"

#### 3.8 Eliminar Passkey - Exitoso (US-007)
1. Registrar un tercer dispositivo
2. Eliminar el segundo (no el actual ni el último)
3. **✅ Verificar**:
   - Confirmación "Are you sure..."
   - Llamada `DELETE` retorna 204
   - Passkey removido de la lista
   - AC-007.2: Todas las sesiones del passkey revocadas

### ✅ Resultado Esperado
- Todas las operaciones CRUD funcionan
- Validaciones de seguridad activas (último passkey, etc.)
- UI se actualiza reactivamente

---

## 🧪 Test Suite 4: Modo Browser vs Server

### Objetivo
Verificar que la funcionalidad de devices solo está disponible en modo servidor.

### Pasos

#### 4.1 Probar en Modo Browser
1. Cambiar `env.js`:
   ```javascript
   wallet_mode: ""  // browser mode
   ```
2. Recargar app
3. Ir a Settings
4. **✅ Verificar**: NO aparece link "My Devices"
5. Intentar navegar manualmente a `/tabs/devices`
6. **✅ Verificar**: Redirección automática a `/tabs/settings`

#### 4.2 Restaurar Modo Server
1. Cambiar `env.js`:
   ```javascript
   wallet_mode: "server"
   ```
2. Recargar app
3. **✅ Verificar**: Link "My Devices" visible de nuevo

### ✅ Resultado Esperado
- Devices solo accesible en modo servidor
- Redirección automática en modo browser

---

## 🧪 Test Suite 5: UX y Validaciones

### Objetivo
Verificar la experiencia de usuario y manejo de errores.

### Pasos

#### 5.1 Estados de Carga
1. Ir a `/tabs/devices`
2. **✅ Verificar**: Spinner mientras carga (loading state)
3. **✅ Verificar**: Lista aparece cuando termina

#### 5.2 Estado Vacío
1. En el backend, eliminar todos los passkeys del usuario
2. Refrescar `/tabs/devices`
3. **✅ Verificar**: Icono y mensaje "No passkeys registered"

#### 5.3 Manejo de Errores de Red
1. Detener el backend
2. Ir a `/tabs/devices`
3. **✅ Verificar**: Icono de error y mensaje "Could not load your devices"
4. **✅ Verificar**: Botón "Retry" visible
5. Reiniciar backend y click "Retry"
6. **✅ Verificar**: Lista carga correctamente

#### 5.4 Validación de Nombres
1. Renombrar passkey con nombre vacío o solo espacios
2. **✅ Verificar**: Botón "Rename" no hace nada (validación `trim()`)

### ✅ Resultado Esperado
- Estados visuales claros (loading, error, empty)
- Manejo robusto de errores
- Validaciones de entrada

---

## 📊 Checklist Final

### Funcionalidades Core
- [ ] Re-autenticación post-logout funciona sin crear nuevo passkey
- [ ] Registro de passkey en servidor (US-005)
- [ ] Listar passkeys (US-006)
- [ ] Renombrar passkey (US-008)
- [ ] Eliminar passkey (US-007)
- [ ] Protección contra eliminar último passkey (AC-007.4)
- [ ] Revocar sesiones remotas (US-009)
- [ ] Indicador de sesiones activas (US-010)

### Integración
- [ ] Link en Settings solo visible en modo servidor
- [ ] Ruta `/tabs/devices` lazy-loaded
- [ ] Redirección en modo browser

### UX/UI
- [ ] Loading states funcionan
- [ ] Error states con retry
- [ ] Empty state
- [ ] Confirmaciones de acciones destructivas
- [ ] Badges de sesiones activas (verde/gris)
- [ ] Nombres de dispositivos auto-detectados

### Traducciones
- [ ] Textos en inglés correctos
- [ ] Textos de re-auth agregados

### Seguridad
- [ ] No se puede eliminar último passkey
- [ ] Sesiones revocadas remotamente funcionan
- [ ] Re-autenticación requiere OTP válido

---

## 🐛 Problemas Comunes y Soluciones

### Problema: "No refresh token" en login
**Causa**: Modo browser activado o backend no configurado  
**Solución**: Verificar `wallet_mode: "server"` en `env.js`

### Problema: "My Devices" no aparece
**Causa**: Modo browser  
**Solución**: Cambiar a modo servidor

### Problema: Passkey no se registra en servidor
**Causa**: Backend no implementado o error de CORS  
**Solución**: Verificar logs del backend y headers CORS

### Problema: No puedo eliminar ningún passkey
**Causa**: Es el último  
**Solución**: Registrar desde otro dispositivo primero

### Problema: Modal de renombrar no aparece
**Causa**: AlertController no configurado  
**Solución**: Verificar imports de Ionic

---

## 🎉 Conclusión del Testing

Si todos los tests pasan, la implementación de EUDI-044 está completa y funcional. 

**Próximos pasos**:
1. Tests automatizados (E2E con Cypress/Playwright)
2. Tests de carga con múltiples dispositivos
3. Tests de seguridad (intentos de bypass)

