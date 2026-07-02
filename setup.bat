@echo off
title INSTALADOR UNIVERSAL DEL BOT
color 0B

echo ========================================================
echo   PREPARANDO COMPUTADORA PARA EL BOT DE WHATSAPP
echo ========================================================
echo.
echo Este instalador va a descargar las herramientas necesarias 
echo si esta computadora es nueva (NodeJS, Python, FFmpeg y yt-dlp).
echo.
echo [1/4] Descargando NodeJS (Motor del Bot)...
winget install OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements

echo.
echo [2/4] Descargando Python (Para buscar musica)...
winget install Python.Python.3.11 -e --accept-package-agreements --accept-source-agreements

echo.
echo [3/4] Descargando FFmpeg (Para procesar Notas de Voz)...
winget install Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements

echo.
echo [4/4] Instalando modulos internos del Bot...
:: Actualiza la variable PATH para esta sesión para que pip y npm existan si acaban de instalarse
set PATH=%PATH%;"C:\Program Files\nodejs\";"C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python311\Scripts\"
python -m pip install --upgrade pip
python -m pip install yt-dlp
npm install

echo.
echo ========================================================
echo   ¡TODO ESTA INSTALADO Y LISTO!
echo ========================================================
echo Tu computadora ha sido configurada. 
echo A partir de ahora, solo dale doble click a "start.bat" para encender el bot.
pause
