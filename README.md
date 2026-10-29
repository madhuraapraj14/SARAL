# SARAL — Heritage, Local Makers & SmartRoute

SARAL is a frontend-preserving Idea Lab project with a Flask backend, SQLite authentication/order storage, CSV-backed heritage/artisan/product data, and nearby public-transport discovery for mapped heritage locations.

## Run in VS Code (Windows)

1. Extract `SARAL_Final.zip`.
2. Open the extracted `SARAL_Final` folder in VS Code.
3. Open **Terminal → New Terminal** and run:

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py
```

4. Open **http://127.0.0.1:5001**. Do not use Live Server or open `index.html` directly; Flask serves the frontend and API together.

If the `py` command is not available, install Python 3.10+ from python.org and select the option to add Python to PATH.

## If the map still fails

This package defaults to port **5001** to avoid accidentally using an older SARAL server still running on port 5000. Open `http://127.0.0.1:5001/api/heritage` first; a successful response contains a `places` array and `count` (16). If it fails, inspect the terminal running `app.py` for the full traceback. Keep the `data` folder beside `app.py`.

## What's included

- `index.html`, `style.css`, `script.js`, `logo.svg`: the frontend files. `style.css` is unchanged from the supplied integrated frontend; JS now loads places/products from the backend.
- `app.py`: Flask API, session-based login/signup/logout, SQLite orders, heritage and maker APIs, SmartRoute transport lookup and community-pulse endpoint.
- `data/heritage_sites.csv`: 16 mapped heritage/cultural locations around Mira-Bhayandar and nearby Mumbai areas.
- `data/artisans.csv`: editable artisan profile records.
- `data/products.csv`: editable product catalogue and craft-story details.
- `requirements.txt`: Flask and QR-code generation dependencies.
- `saral.db`: created automatically on first run; do not add this file to version control if using real user data.

## Main API routes

- `GET /api/health`
- `GET /api/heritage`
- `GET /api/artisans` and `GET /api/artisans/<id>`
- `GET /api/products`
- `GET /api/transport?lat=<latitude>&lon=<longitude>&radius=3000` (OpenStreetMap Overpass lookup)
- `GET /api/impact`
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/orders`, `GET /api/orders`

## Editing CSV data

The backend reads CSV files from `data/` on each request, so updates to those CSVs appear without editing JavaScript. Keep column names and ID relationships consistent. Product `artisan_id` must match an artisan ID.

The 16 location records are starter/demo data. Coordinates, photo links, site descriptions, and public access can change or need local confirmation. Verify them before a public release. Artisan profiles and catalogue records are clearly marked as demo/sample records; do not present them as verified real makers or verified product provenance until you replace them with confirmed information.

## Demo limitations and safety

- Checkout records a demo order in SQLite and does not accept payments.
- Community Pulse displays recorded demo order counts/value only; it does not claim verified artisan payouts or independently measured social impact.
- SmartRoute queries OpenStreetMap for mapped nearby public-transport stops. Data coverage may be incomplete; live arrival times, fares, and service status are not provided.
- Before deployment, configure a stable random `SARAL_SECRET_KEY`, HTTPS, CSRF protection, rate limiting, backups, and production hosting. Do not use sample passwords or demo records with real customers.


## Heritage map troubleshooting
- Extract the entire ZIP before running it; do not run app.py from inside the ZIP preview.
- Open the folder containing app.py in VS Code and run it with your project's Python environment.
- Keep the `data` folder next to app.py; it should contain `heritage_sites.csv`, `artisans.csv`, and `products.csv`.
- Visit `http://127.0.0.1:5001/api/heritage`. It should return JSON with a `places` array and a count. Error responses now include a diagnostic detail and expected CSV path.

## SmartRoute
Select a heritage place from the map list or marker popup and use “Find nearby transport” to view mapped bus stops, railway/metro stations and ferry terminals within 3 km. Results come from OpenStreetMap Overpass when the service is reachable. Google Maps links are provided as a fallback.
