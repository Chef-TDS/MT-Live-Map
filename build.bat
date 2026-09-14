@echo off
echo ========================================
echo Motor Town Live Map - Build Script
echo ========================================
echo.

echo Checking for Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Node.js found!
node --version
echo.

echo Checking for npm...
npm --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm is not installed!
    pause
    exit /b 1
)

echo npm found!
npm --version
echo.

echo Installing dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: Failed to install dependencies!
    pause
    exit /b 1
)

echo.
echo Dependencies installed successfully!
echo.
echo ========================================
echo Building application...
echo ========================================
echo.

call npm run build:win
if errorlevel 1 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build completed successfully!
echo ========================================
echo.
echo Your distributable files are in the 'dist' folder:
echo - Motor Town Live Map Setup 1.0.0.exe (Installer)
echo - Motor Town Live Map 1.0.0-portable.exe (Portable)
echo.
echo You can now distribute these files to your admins!
echo.
pause
