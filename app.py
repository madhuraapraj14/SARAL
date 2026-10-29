from flask import Flask, jsonify, request, session, send_from_directory, make_response
from werkzeug.security import generate_password_hash, check_password_hash
from pathlib import Path
import csv, sqlite3, os, secrets, json, urllib.parse, urllib.request

BASE_DIR = Path(__file__).resolve().parent
# Locate the CSV folder robustly if the ZIP was extracted with an extra nesting level.
def locate_data_dir():
    candidates = [BASE_DIR / 'data', BASE_DIR, BASE_DIR / 'SARAL_Final' / 'data']
    for candidate in candidates:
        if (candidate / 'heritage_sites.csv').is_file():
            return candidate
    return BASE_DIR / 'data'
DATA_DIR = locate_data_dir()
DB_PATH = BASE_DIR / 'saral.db'
app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get('SARAL_SECRET_KEY') or secrets.token_hex(32)
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax')


def read_csv(filename):
    path = DATA_DIR / filename
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def heritage_data():
    rows = read_csv('heritage_sites.csv')
    for row in rows:
        row['id'] = int(row['id'])
        row['coords'] = [float(row.pop('latitude')), float(row.pop('longitude'))]
        row['photoCredit'] = row.pop('photo_credit')
        row['area'] = row.get('area', '')
        row['sourceNote'] = row.pop('source_note', '')
    return rows


def artisan_data():
    rows = read_csv('artisans.csv')
    for row in rows:
        row['id'] = int(row['id'])
        row['share_percent'] = int(row['share_percent'])
    return rows


def product_data():
    rows = read_csv('products.csv')
    for row in rows:
        for key in ('id', 'artisan_id', 'price'):
            row[key] = int(row[key])
    return rows


def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys = ON')
    return con


def init_db():
    with db() as con:
        con.execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
        con.execute("CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'received', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))")
        con.execute("CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL, product_name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id))")


def public_user(row):
    return {'id': row['id'], 'name': row['name'], 'email': row['email']}


def current_user():
    uid = session.get('user_id')
    if not uid:
        return None
    with db() as con:
        row = con.execute('SELECT id,name,email FROM users WHERE id=?', (uid,)).fetchone()
    return public_user(row) if row else None


def error(message, status=400):
    return jsonify({'message': message}), status


@app.get('/')
def index():
    return send_from_directory(BASE_DIR, 'index.html')


@app.get('/<path:path>')
def static_files(path):
    if path.startswith('api/'):
        return error('API endpoint not found.', 404)
    target = (BASE_DIR / path).resolve()
    if BASE_DIR not in target.parents or not target.is_file():
        return error('File not found.', 404)
    return send_from_directory(BASE_DIR, path)


@app.get('/api/health')
def health():
    return jsonify({'status': 'ok', 'service': 'SARAL API'})


@app.get('/api/heritage')
def heritage():
    try:
        places = heritage_data()
        return jsonify({'places': places, 'count': len(places)})
    except Exception as exc:
        app.logger.exception('Could not load heritage CSV')
        return jsonify({'message': 'Could not read heritage data.', 'detail': str(exc), 'data_dir': str(DATA_DIR), 'expected_file': str(DATA_DIR / 'heritage_sites.csv')}), 500


@app.get('/api/transport')
def nearby_transport():
    """Find mapped nearby public-transport stops using OpenStreetMap Overpass."""
    try:
        lat = float(request.args.get('lat', ''))
        lon = float(request.args.get('lon', ''))
        radius = min(max(int(request.args.get('radius', '3000')), 500), 10000)
    except (TypeError, ValueError):
        return error('Provide valid lat and lon coordinates.')
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return error('Coordinates are out of range.')
    query = f'''[out:json][timeout:12];(node(around:{radius},{lat},{lon})[highway=bus_stop];node(around:{radius},{lat},{lon})[public_transport=platform];way(around:{radius},{lat},{lon})[public_transport=platform];node(around:{radius},{lat},{lon})[railway=station];way(around:{radius},{lat},{lon})[railway=station];node(around:{radius},{lat},{lon})[railway=halt];node(around:{radius},{lat},{lon})[station=subway];way(around:{radius},{lat},{lon})[station=subway];node(around:{radius},{lat},{lon})[amenity=ferry_terminal];);out center tags;'''
    # Public Overpass instances can be rate-limited. Try several mirrors with short timeouts.
    endpoints = [
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass-api.de/api/interpreter',
        'https://overpass.private.coffee/api/interpreter',
    ]
    payload = None
    errors = []
    for endpoint in endpoints:
        try:
            encoded = urllib.parse.urlencode({'data': query}).encode('utf-8')
            req = urllib.request.Request(endpoint, data=encoded, headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'SARAL-IdeaLab/1.1 (heritage public transport lookup)'
            }, method='POST')
            with urllib.request.urlopen(req, timeout=10) as response:
                payload = json.loads(response.read().decode('utf-8'))
            break
        except Exception as exc:
            errors.append(f'{endpoint}: {exc}')
    if payload is None:
        app.logger.warning('All transport data providers failed: %s', ' | '.join(errors))
        return jsonify({
            'message': 'The public transport data providers are temporarily busy. Use the Google Maps link below to view nearby transport.',
            'detail': 'All OpenStreetMap query mirrors failed or timed out.',
            'stops': [], 'count': 0, 'radius_m': radius,
            'fallback_url': f'https://www.google.com/maps/search/public+transport/@{lat},{lon},15z'
        }), 200
    stops=[]
    for item in payload.get('elements', []):
        tags=item.get('tags', {})
        name=tags.get('name') or tags.get('local_ref') or 'Unnamed transport stop'
        ilat=item.get('lat', item.get('center',{}).get('lat'))
        ilon=item.get('lon', item.get('center',{}).get('lon'))
        if ilat is None or ilon is None: continue
        if tags.get('amenity') == 'ferry_terminal': kind='Ferry terminal'
        elif tags.get('station') == 'subway' or (tags.get('railway') == 'station' and tags.get('station') == 'subway'): kind='Metro station'
        elif tags.get('railway') in ('station','halt'): kind='Railway station'
        elif tags.get('highway') == 'bus_stop': kind='Bus stop'
        elif tags.get('public_transport') == 'platform': kind='Public transport platform'
        else: kind='Public transport stop'
        stops.append({'name':name,'type':kind,'lat':float(ilat),'lon':float(ilon),'tags':{k:tags[k] for k in ('operator','network','ref','wheelchair') if k in tags}})
    unique={}
    for stop in stops:
        key=(stop['name'].casefold(), round(stop['lat'],4), round(stop['lon'],4), stop['type'])
        unique[key]=stop
    from math import radians, sin, cos, asin, sqrt
    def distance(st):
        dlat=radians(st['lat']-lat); dlon=radians(st['lon']-lon)
        a=sin(dlat/2)**2+cos(radians(lat))*cos(radians(st['lat']))*sin(dlon/2)**2
        return 6371000*2*asin(sqrt(min(1,a)))
    results=[]
    for stop in sorted(unique.values(), key=distance)[:30]:
        stop['distance_m']=round(distance(stop))
        results.append(stop)
    return jsonify({'stops':results,'count':len(results),'radius_m':radius,'source':'OpenStreetMap contributors','note':'Mapped stops only. Live arrivals, routes and service status are not provided; map coverage may be incomplete.'})


@app.get('/api/artisans')
def artisans():
    return jsonify({'artisans': artisan_data()})


@app.get('/api/artisans/<int:artisan_id>')
def artisan_detail(artisan_id):
    maker = next((a for a in artisan_data() if a['id'] == artisan_id), None)
    if not maker:
        return error('Artisan not found.', 404)
    maker['products'] = [p for p in product_data() if p['artisan_id'] == artisan_id]
    return jsonify({'artisan': maker})


@app.get('/api/products')
def products():
    return jsonify({'products': product_data()})


@app.post('/api/auth/signup')
def signup():
    data = request.get_json(silent=True) or {}
    name = str(data.get('name', '')).strip()
    email = str(data.get('email', '')).strip().lower()
    password = str(data.get('password', ''))
    if len(name) < 2:
        return error('Please enter your name.')
    if '@' not in email or '.' not in email.rsplit('@', 1)[-1]:
        return error('Please enter a valid email address.')
    if len(password) < 8:
        return error('Password must be at least 8 characters.')
    try:
        with db() as con:
            cur = con.execute('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)', (name, email, generate_password_hash(password)))
            uid = cur.lastrowid
    except sqlite3.IntegrityError:
        return error('An account with this email already exists. Please log in.', 409)
    session.clear()
    session['user_id'] = uid
    return jsonify({'message': 'Account created.', 'user': {'id': uid, 'name': name, 'email': email}}), 201


@app.post('/api/auth/login')
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get('email', '')).strip().lower()
    password = str(data.get('password', ''))
    with db() as con:
        row = con.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
    if not row or not check_password_hash(row['password_hash'], password):
        return error('Email or password is incorrect.', 401)
    session.clear()
    session['user_id'] = row['id']
    return jsonify({'message': 'Logged in.', 'user': public_user(row)})


@app.get('/api/auth/me')
def me():
    user = current_user()
    if not user:
        return error('Not logged in.', 401)
    return jsonify({'user': user})


@app.post('/api/auth/logout')
def logout():
    session.clear()
    return jsonify({'message': 'Logged out.'})


@app.post('/api/orders')
def create_order():
    user = current_user()
    if not user:
        return error('Please log in before placing an order.', 401)
    items = (request.get_json(silent=True) or {}).get('items')
    if not isinstance(items, list) or not items:
        return error('Your bag is empty.')
    catalog = {p['id']: p for p in product_data()}
    normalized, total = [], 0
    for item in items:
        try:
            pid, qty = int(item.get('product_id')), int(item.get('quantity', 1))
        except (TypeError, ValueError, AttributeError):
            return error('Invalid item in your bag.')
        if pid not in catalog or qty < 1 or qty > 20:
            return error('One of the items is invalid.')
        p = catalog[pid]
        normalized.append((pid, p['name'], qty, p['price']))
        total += qty * p['price']
    with db() as con:
        cur = con.execute('INSERT INTO orders(user_id,total) VALUES(?,?)', (user['id'], total))
        order_id = cur.lastrowid
        con.executemany('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price) VALUES(?,?,?,?,?)', [(order_id, *x) for x in normalized])
    return jsonify({'message': 'Order recorded. This demo does not process payments.', 'order_id': order_id, 'total': total, 'status': 'received'}), 201


@app.get('/api/orders')
def my_orders():
    user = current_user()
    if not user:
        return error('Please log in to view orders.', 401)
    with db() as con:
        rows = con.execute('SELECT id,total,status,created_at FROM orders WHERE user_id=? ORDER BY id DESC', (user['id'],)).fetchall()
    return jsonify({'orders': [dict(r) for r in rows]})


@app.get('/api/impact')
def impact():
    with db() as con:
        totals = con.execute('SELECT COUNT(DISTINCT o.id) orders_count, COALESCE(SUM(oi.quantity),0) items_count, COALESCE(SUM(oi.quantity*oi.unit_price),0) gross_value FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id').fetchone()
    return jsonify({'orders': totals['orders_count'], 'items': totals['items_count'], 'gross_order_value_inr': totals['gross_value'], 'note': 'Gross demo order value is not the same as verified artisan payout or social impact.'})


init_db()
if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.environ.get('PORT', '5001')), debug=False)
