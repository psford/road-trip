#!/usr/bin/env python3
"""
POI Seeder Dashboard — local web UI for monitoring and controlling the Overpass data pipeline.

Shows a US map with 5x5 degree tile grid, color-coded by status:
  - Green: tile has POI data in the database
  - Red: tile failed last attempt
  - Gray: tile not yet attempted
  - Blue: currently fetching

Auto-polls Overpass API status. Click a tile to manually seed it.

Usage:
    pip install flask pyodbc
    python tools/poi-dashboard/server.py

    Open http://localhost:5200
"""

import json
import os
import sys
import time
import threading
import subprocess
import urllib.request
import urllib.parse
from datetime import datetime

# Add project root to path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

try:
    from flask import Flask, jsonify, send_from_directory, request
except ImportError:
    print("Flask not installed. Run: pip install flask")
    sys.exit(1)

app = Flask(__name__, static_folder='static')

# -------------------------------------------------------------------
# State
# -------------------------------------------------------------------

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# WSL_SQL_CONNECTION is a .NET-style connection string; pyodbc needs ODBC-style.
# Convert or use ODBC format directly.
_wsl_conn = os.environ.get('WSL_SQL_CONNECTION', '')
if _wsl_conn and 'Driver' not in _wsl_conn:
    # .NET format: Server=x;Database=y;User Id=z;Password=w;TrustServerCertificate=True
    # Convert to ODBC format
    parts = dict(p.split('=', 1) for p in _wsl_conn.split(';') if '=' in p)
    DB_CONN_STR = (
        f"Driver={{ODBC Driver 18 for SQL Server}};"
        f"Server={parts.get('Server', '127.0.0.1,1433')};"
        f"Database={parts.get('Database', 'StockAnalyzer')};"
        f"Uid={parts.get('User Id', 'sa')};"
        f"Pwd={parts.get('Password', '')};"
        f"TrustServerCertificate=yes;"
    )
else:
    DB_CONN_STR = _wsl_conn or 'Driver={ODBC Driver 18 for SQL Server};Server=127.0.0.1,1433;Database=StockAnalyzer;Uid=wsl_claude;Pwd=g@m2TvkJ%AFAs92Falb7QP5a;TrustServerCertificate=yes;'

# Generate 5-degree tiles covering continental US
def generate_tiles():
    tiles = []
    for lat in range(25, 50, 5):
        for lng in range(-125, -65, 5):
            tiles.append({
                'id': f'{lat}_{lng}',
                'south': lat, 'west': lng,
                'north': min(lat + 5, 50), 'east': min(lng + 5, -65),
                'status': 'pending',  # pending, fetching, success, failed
                'poi_count': 0,
                'last_attempt': None,
                'error': None,
            })
    return tiles

tiles = generate_tiles()
tile_lock = threading.Lock()
overpass_status = {'up': False, 'last_check': None, 'response_ms': None}
auto_poll_active = False
auto_poll_thread = None

# -------------------------------------------------------------------
# Database helpers
# -------------------------------------------------------------------

def get_db_connection():
    try:
        import pyodbc
        return pyodbc.connect(DB_CONN_STR)
    except Exception as e:
        print(f"DB connection failed: {e}")
        return None

def get_poi_counts_by_tile():
    """Query DB for POI counts grouped by 5-degree tile."""
    conn = get_db_connection()
    if not conn:
        return {}
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                FLOOR(Latitude / 5) * 5 AS tile_lat,
                FLOOR(Longitude / 5) * 5 AS tile_lng,
                COUNT(*) AS cnt
            FROM roadtrip.PointsOfInterest
            WHERE Source = 'osm'
            GROUP BY FLOOR(Latitude / 5) * 5, FLOOR(Longitude / 5) * 5
        """)
        counts = {}
        for row in cursor.fetchall():
            key = f'{int(row[0])}_{int(row[1])}'
            counts[key] = row[2]
        return counts
    except Exception as e:
        print(f"DB query failed: {e}")
        return {}
    finally:
        conn.close()

def get_total_poi_count():
    conn = get_db_connection()
    if not conn:
        return {'total': 0, 'nps': 0, 'osm': 0}
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT Source, COUNT(*) FROM roadtrip.PointsOfInterest GROUP BY Source
        """)
        counts = {'total': 0, 'nps': 0, 'osm': 0, 'pad_us': 0}
        for row in cursor.fetchall():
            counts[row[0]] = row[1]
            counts['total'] += row[1]
        return counts
    except Exception as e:
        print(f"DB query failed: {e}")
        return {'total': 0, 'nps': 0, 'osm': 0}
    finally:
        conn.close()

# -------------------------------------------------------------------
# Overpass helpers
# -------------------------------------------------------------------

def check_overpass_status():
    """Quick probe to see if Overpass is responding."""
    global overpass_status
    try:
        probe = '[out:json][timeout:5];node["natural"="peak"](44.2,-71.4,44.25,-71.35);out body 1;'
        data = urllib.parse.urlencode({'data': probe}).encode()
        req = urllib.request.Request(OVERPASS_URL, data=data,
            headers={'User-Agent': 'RoadTripMap-Dashboard/1.0'})
        start = time.time()
        resp = urllib.request.urlopen(req, timeout=10)
        body = resp.read().decode()
        elapsed = int((time.time() - start) * 1000)
        is_up = '"elements"' in body
        overpass_status = {
            'up': is_up,
            'last_check': datetime.now().isoformat(),
            'response_ms': elapsed,
        }
    except Exception as e:
        overpass_status = {
            'up': False,
            'last_check': datetime.now().isoformat(),
            'response_ms': None,
            'error': str(e)[:100],
        }
    return overpass_status

def fetch_tile_from_overpass(tile_id):
    """Run the Overpass queries for a single tile and upsert into DB."""
    with tile_lock:
        tile = next((t for t in tiles if t['id'] == tile_id), None)
        if not tile:
            return {'error': 'tile not found'}
        tile['status'] = 'fetching'
        tile['last_attempt'] = datetime.now().isoformat()

    south, west, north, east = tile['south'], tile['west'], tile['north'], tile['east']
    bbox = f"({south},{west},{north},{east})"

    query_types = {
        'tourism': f'[out:json][timeout:60];node["tourism"~"attraction|museum|viewpoint"]{bbox};out body;',
        'historic': f'[out:json][timeout:60];node["historic"~"monument|memorial|castle|ruins|archaeological_site|battlefield"]{bbox};out body;',
        'natural': f'[out:json][timeout:60];(node["natural"="peak"]{bbox};node["natural"="waterfall"]{bbox};node["natural"="volcano"]{bbox};node["natural"="cave_entrance"]{bbox};);out body;',
        'nature_reserve': f'[out:json][timeout:60];node["leisure"="nature_reserve"]{bbox};out body;',
    }

    total_count = 0
    errors = []

    for qtype, query in query_types.items():
        try:
            data = urllib.parse.urlencode({'data': query}).encode()
            req = urllib.request.Request(OVERPASS_URL, data=data,
                headers={'User-Agent': 'RoadTripMap-Dashboard/1.0'})
            resp = urllib.request.urlopen(req, timeout=120)
            body = json.loads(resp.read().decode())
            elements = body.get('elements', [])

            # Upsert into DB
            conn = get_db_connection()
            if conn:
                cursor = conn.cursor()
                for el in elements:
                    if el.get('type') != 'node':
                        continue
                    tags = el.get('tags', {})
                    name = tags.get('name')
                    if not name:
                        continue

                    lat = el['lat']
                    lon = el['lon']
                    source_id = str(el['id'])

                    # Map category
                    if 'tourism' in tags:
                        category = 'tourism'
                    elif 'historic' in tags:
                        category = 'historic_site'
                    elif 'natural' in tags or 'leisure' in tags:
                        category = 'natural_feature'
                    else:
                        category = 'tourism'

                    # Upsert
                    cursor.execute("""
                        MERGE roadtrip.PointsOfInterest AS target
                        USING (SELECT ? AS Source, ? AS SourceId) AS source
                        ON target.Source = source.Source AND target.SourceId = source.SourceId
                        WHEN MATCHED THEN
                            UPDATE SET Name = ?, Category = ?, Latitude = ?, Longitude = ?
                        WHEN NOT MATCHED THEN
                            INSERT (Name, Category, Latitude, Longitude, Source, SourceId)
                            VALUES (?, ?, ?, ?, ?, ?);
                    """, 'osm', source_id,
                         name, category, lat, lon,
                         name, category, lat, lon, 'osm', source_id)
                    total_count += 1

                conn.commit()
                conn.close()

            # Rate limit between query types
            time.sleep(5)

        except Exception as e:
            errors.append(f"{qtype}: {str(e)[:80]}")
            time.sleep(10)  # longer backoff on error

    with tile_lock:
        if errors and total_count == 0:
            tile['status'] = 'failed'
            tile['error'] = '; '.join(errors)
        else:
            tile['status'] = 'success'
            tile['poi_count'] = total_count
            tile['error'] = '; '.join(errors) if errors else None

    return {'tile_id': tile_id, 'count': total_count, 'errors': errors}

# -------------------------------------------------------------------
# Auto-poll
# -------------------------------------------------------------------

def auto_poll_worker():
    """Background thread that seeds all pending/failed tiles when Overpass is up."""
    global auto_poll_active
    while auto_poll_active:
        status = check_overpass_status()
        if not status['up']:
            time.sleep(30)
            continue

        # Find next tile to seed
        with tile_lock:
            target = None
            for t in tiles:
                if t['status'] in ('pending', 'failed'):
                    target = t['id']
                    break

        if target:
            fetch_tile_from_overpass(target)
            time.sleep(5)  # rate limit between tiles
        else:
            # All tiles done
            auto_poll_active = False
            break

# -------------------------------------------------------------------
# Routes
# -------------------------------------------------------------------

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/api/status')
def api_status():
    counts = get_total_poi_count()
    db_counts = get_poi_counts_by_tile()

    # Update tile poi_counts from DB
    with tile_lock:
        for t in tiles:
            db_count = db_counts.get(t['id'], 0)
            if db_count > 0:
                t['poi_count'] = db_count
                if t['status'] == 'pending':
                    t['status'] = 'success'

    return jsonify({
        'overpass': overpass_status,
        'tiles': tiles,
        'poi_counts': counts,
        'auto_poll': auto_poll_active,
    })

@app.route('/api/check-overpass')
def api_check_overpass():
    return jsonify(check_overpass_status())

@app.route('/api/seed-tile/<tile_id>', methods=['POST'])
def api_seed_tile(tile_id):
    result = fetch_tile_from_overpass(tile_id)
    return jsonify(result)

@app.route('/api/seed-all', methods=['POST'])
def api_seed_all():
    global auto_poll_active, auto_poll_thread
    if auto_poll_active:
        return jsonify({'status': 'already running'})
    auto_poll_active = True
    auto_poll_thread = threading.Thread(target=auto_poll_worker, daemon=True)
    auto_poll_thread.start()
    return jsonify({'status': 'started'})

@app.route('/api/stop', methods=['POST'])
def api_stop():
    global auto_poll_active
    auto_poll_active = False
    return jsonify({'status': 'stopped'})

if __name__ == '__main__':
    # Initial status check
    check_overpass_status()
    # Sync tile status from DB
    db_counts = get_poi_counts_by_tile()
    for t in tiles:
        c = db_counts.get(t['id'], 0)
        if c > 0:
            t['poi_count'] = c
            t['status'] = 'success'

    print(f"POI Dashboard: http://localhost:5200")
    print(f"Overpass status: {'UP' if overpass_status['up'] else 'DOWN'}")
    print(f"DB POI counts: {json.dumps(get_total_poi_count())}")
    app.run(host='127.0.0.1', port=5200, debug=False)
