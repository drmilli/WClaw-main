# Check if bun is installed
if (-not (Get-Command "bun" -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Bun is not installed. Please install Bun first." -ForegroundColor Red
    exit 1
}

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "Error: .env file not found. Please create one from .env.example." -ForegroundColor Red
    exit 1
}

# Start the bot
Write-Host "Starting WeatherClaw in LIVE mode..." -ForegroundColor Cyan
bun run src/index.ts
