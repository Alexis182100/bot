@echo off
title START - WhatsApp Bot (Consola Maestra)
color 0A

echo ========================================================
echo   INICIANDO SISTEMA BOT MAESTRO (WhatsApp) 
echo ========================================================

:: Comprobando instalacion de NodeJS
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] No tienes NodeJS instalado en esta computadora.
    echo Por favor descarga NodeJS de https://nodejs.org/ e instalalo.
    pause
    exit
)

:: Instalando modulos faltantes si no estan
echo [1/2] Verificando Paquetes y Librerias...
if not exist "node_modules\" (
    echo [INFO] Instalando modulos por primera vez...
    npm install
)

:: Arrancando el Bot
echo [2/2] Encendiendo Motor de WhatsApp Web...
node index.js
pause
