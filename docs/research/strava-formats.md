# Research: Strava Upload Formats & Polar-to-Strava Conversion

## 1. File Formats Strava Accepts

Strava accepts the following file formats for manual upload (via web UI at `/upload/select` or via API):

| Format | Extension | Description |
|--------|-----------|-------------|
| **FIT** | `.fit` | Garmin's Flexible and Interoperable Data Transfer protocol. Binary format. Most widely supported. |
| **TCX** | `.tcx` | Training Center XML. Garmin's XML-based format. |
| **GPX** | `.gpx` | GPS Exchange Format. Open standard XML format. |
| **GZ** (compressed) | `.fit.gz`, `.tcx.gz`, `.gpx.gz` | Gzip-compressed versions of the above formats. |

**Important notes:**
- Strava does NOT accept Polar's native JSON export format
- Strava does NOT accept `.csv` files
- You can upload up to **25 files at once** via the web interface
- Maximum file size: **25 MB** per file
- One activity per file (TCX technically supports multiple laps but one activity)
- The API endpoint is `POST https://www.strava.com/api/v3/uploads` with `data_type` parameter: `fit`, `fit.gz`, `tcx`, `tcx.gz`, `gpx`, `gpx.gz`

---

## 2. TCX File Format Structure

TCX (Training Center XML) is an XML format defined by Garmin. Here is the required structure:

### XML Namespaces
```xml
<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2
    http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
```

### Required Elements (minimum for Strava to accept)
```xml
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">          <!-- Sport: Running, Biking, Other -->
      <Id>2024-01-15T10:30:00.000Z</Id> <!-- ISO 8601 timestamp (activity start time) -->
      <Lap StartTime="2024-01-15T10:30:00.000Z">
        <TotalTimeSeconds>3600</TotalTimeSeconds>
        <DistanceMeters>10000</DistanceMeters>
        <Calories>500</Calories>
        <Intensity>Active</Intensity>    <!-- Active or Resting -->
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          <Trackpoint>
            <Time>2024-01-15T10:30:00.000Z</Time>
            <Position>                   <!-- Optional but recommended -->
              <LatitudeDegrees>37.7749</LatitudeDegrees>
              <LongitudeDegrees>-122.4194</LongitudeDegrees>
            </Position>
            <AltitudeMeters>10.0</AltitudeMeters>
            <DistanceMeters>0</DistanceMeters>
            <HeartRateBpm>
              <Value>140</Value>
            </HeartRateBpm>
            <Cadence>85</Cadence>        <!-- Optional: steps/min for running, rpm for cycling -->
            <Extensions>
              <ns3:TPX>
                <ns3:Speed>2.78</ns3:Speed>  <!-- m/s -->
                <ns3:RunCadence>170</ns3:RunCadence>
                <ns3:Watts>250</ns3:Watts>   <!-- Power in watts -->
              </ns3:TPX>
            </Extensions>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
```

### TCX Sport Types (Activity attribute)
The TCX `Sport` attribute only has 3 valid values:
- `Running`
- `Biking`
- `Other`

Strava will map these to its own activity types. You can change the activity type in Strava after upload.

### Key Points for TCX:
- **Time is required** on every Trackpoint - Strava uses this to calculate pace/speed
- **Position is optional** - activities without GPS are accepted (indoor workouts)
- **DistanceMeters in Lap** - total distance for the lap
- **HeartRateBpm** - important for HR-based activities
- **Multiple Laps** are supported within one Activity
- **Extensions namespace** (`ns3:TPX`) used for power, speed, cadence extensions

---

## 3. GPX File Format Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="YourApp"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <time>2024-01-15T10:30:00Z</time>
  </metadata>
  <trk>
    <name>Morning Run</name>
    <type>running</type>     <!-- Strava activity type hint -->
    <trkseg>
      <trkpt lat="37.7749" lon="-122.4194">
        <ele>10.0</ele>
        <time>2024-01-15T10:30:00Z</time>
        <extensions>
          <gpxtpx:TrackPointExtension>
            <gpxtpx:hr>140</gpxtpx:hr>
            <gpxtpx:cad>85</gpxtpx:cad>
          </gpxtpx:TrackPointExtension>
        </extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>
```

**GPX limitations for Strava:**
- GPX requires lat/lon on trackpoints (no indoor activities without GPS)
- Less metadata than TCX (no calories, no lap summaries)
- Heart rate and cadence must go in extensions

---

## 4. FIT File Format Structure

FIT (Flexible and Interoperable Data Transfer) is a binary protocol by Garmin/ANT+.

### Key characteristics:
- **Binary format** - not human-readable
- **Most compact** - smallest file size
- **Most feature-rich** - supports the most data fields
- **SDK available** - Garmin FIT SDK provides libraries in C, Java, C#, Python

### FIT File Structure (conceptual):
```
File Header (14 bytes)
  - Header size, protocol version, profile version, data size, ".FIT" signature, CRC

Data Records:
  - File ID Message (required): type, manufacturer, product, serial_number, time_created
  - Session Message: sport, sub_sport, start_time, total_elapsed_time, total_distance
  - Lap Message(s): start_time, total_elapsed_time, total_distance
  - Record Messages (one per sample point):
    - timestamp
    - position_lat (semicircles)
    - position_long (semicircles)
    - altitude (m)
    - heart_rate (bpm)
    - cadence (rpm)
    - distance (m, cumulative)
    - speed (m/s)
    - power (watts)
    - temperature (C)
  - Event Messages: timer start/stop events
  - Activity Message: total_timer_time, num_sessions

File CRC (2 bytes)
```

### FIT Sport Types (extensive list):
```
0: generic
1: running
2: cycling
3: transition (triathlon)
4: fitness_equipment
5: swimming
6: basketball
7: soccer
8: tennis
9: american_football
10: training
11: walking
12: cross_country_skiing
13: alpine_skiing
14: snowboarding
15: rowing
16: mountaineering
17: hiking
18: multisport
19: paddling
20: flying
21: e_biking
22: motorcycling
23: boating
24: driving
25: golf
...and many more
```

### Python FIT SDK:
The `fitparse` library reads FIT files. For writing, use `fit_tool` or the Garmin FIT SDK Python bindings.

---

## 5. Strava Recognized Sport/Activity Types

Strava supports these activity types (can be set after upload):

- Run, Trail Run, Walk, Hike
- Ride, Mountain Bike Ride, E-Bike Ride, Gravel Ride
- Swim (Pool), Swim (Open Water)
- Nordic Ski, Alpine Ski, Backcountry Ski, Snowboard, Snowshoe
- Kayaking, Canoeing, Rowing, Stand Up Paddleboarding, Surfing
- Ice Skate, Inline Skate, Skateboard
- Rock Climbing, Bouldering
- Yoga, Pilates, Crossfit, Weight Training, Workout
- Elliptical, Stair Stepper
- Wheelchair (Sport), Wheelchair (Push)
- Handcycle, Velomobile
- Golf, Pickleball, Racquetball, Squash, Badminton, Table Tennis, Tennis
- Virtual Run, Virtual Ride
- Sail, Windsurf, Kitesurf
- and more...

---

## 6. Tredict.com Polar JSON to FIT Converter

### What it does:
- Converts Polar Flow data export JSON files to Garmin FIT format
- Runs **client-side in the browser** (JavaScript/React app)
- Files are processed in RAM only, not uploaded to any server
- The converter JS bundle is at: `/polarjson2fit-converter/static/js/main-77HZRSLN.js`

### How the Polar Export works:
1. User requests a full data export from Polar Flow (https://account.polar.com/)
2. Polar provides a ZIP file containing JSON files for each training session
3. Each JSON file contains: timestamps, heart rate samples, GPS coordinates, speed, cadence, power, altitude, sport type, lap markers, etc.

### Polar JSON structure (typical training session):
```json
{
  "startTime": "2024-01-15 10:30:00.000",
  "duration": "PT1H0M0S",
  "distance": 10000,
  "sport": "RUNNING",
  "heartRate": {
    "avg": 150,
    "max": 175
  },
  "samples": {
    "heartRate": [140, 142, 145, ...],
    "speed": [2.5, 2.6, 2.7, ...],
    "altitude": [10.0, 10.1, ...],
    "cadence": [85, 86, ...],
    "recordedRoute": [
      {"latitude": 37.7749, "longitude": -122.4194, "timestamp": "..."},
      ...
    ]
  },
  "laps": [
    {"duration": "PT30M0S", "distance": 5000},
    ...
  ]
}
```

### Conversion approach (Tredict):
1. Parse Polar JSON file(s)
2. Map Polar sport types to FIT sport enum values
3. Create FIT file structure:
   - File ID message with manufacturer set (likely "development")
   - Session message with sport, duration, distance
   - Lap messages from Polar lap data
   - Record messages from samples (time-aligned HR, GPS, speed, cadence, altitude)
4. Compute CRC and output binary FIT file
5. Offer download to user

### Polar sport type mapping:
| Polar Sport | FIT Sport | Strava Type |
|-------------|-----------|-------------|
| RUNNING | 1 (running) | Run |
| CYCLING | 2 (cycling) | Ride |
| SWIMMING | 5 (swimming) | Swim |
| WALKING | 11 (walking) | Walk |
| HIKING | 17 (hiking) | Hike |
| CROSS_COUNTRY_SKIING | 12 (cross_country_skiing) | Nordic Ski |
| OTHER | 0 (generic) | Workout |

---

## 7. Gotchas and Limitations with Strava Uploads

### File/Upload Limits:
- **25 MB** max file size per file
- **25 files** max per batch upload via web
- **Duplicate detection**: Strava rejects activities with the same start time (within a few seconds) as existing activities
- **Rate limiting on API**: 100 requests per 15 minutes, 1000 per day

### Data Handling:
- **Timestamps must be in UTC** - local timezone offsets can cause issues
- **Timestamps must be ISO 8601** format for TCX/GPX
- **GPS coordinates**: Activities without GPS data ARE accepted but won't have a map
- **Distance calculation**: If no distance field provided, Strava calculates from GPS points
- **Speed/Pace**: Calculated from timestamps + distance or GPS points if not provided
- **Elevation**: Strava may recalculate elevation from its own DEM data

### Common Issues:
1. **Timezone problems**: If timestamps aren't UTC, activity may appear at wrong time
2. **Missing time on trackpoints**: Strava will reject files where trackpoints lack timestamps
3. **Zero-duration activities**: Rejected
4. **Future-dated activities**: May be rejected or flagged
5. **Very old activities**: Accepted (useful for importing history)
6. **Activity type after upload**: Only Running/Biking/Other in TCX; must manually change type in Strava after upload for other sports
7. **Heart rate data**: If present, must be reasonable values (>0, <255 bpm)
8. **Cadence**: Running cadence in TCX is steps per foot (half actual); use RunCadence in extensions for full cadence

### TCX-Specific Gotchas:
- The `Sport` attribute only supports "Running", "Biking", "Other"
- Cadence element in base schema is cycling cadence (RPM); for running cadence use `ns3:RunCadence` in extensions
- Strava uses `<DistanceMeters>` in trackpoints to determine distance; if missing, uses GPS

### FIT-Specific Gotchas:
- Coordinates in FIT use **semicircles** (not degrees): `semicircles = degrees * (2^31 / 180)`
- Timestamps are seconds since **Dec 31, 1989 00:00:00 UTC** (Garmin epoch), not Unix epoch
- Speed in FIT is in **mm/s** (enhanced_speed) or **m/s * 1000**
- File must have valid CRC or Strava rejects it

### GPX-Specific Gotchas:
- Every trackpoint MUST have lat/lon (no indoor activities via GPX)
- Heart rate must be in Garmin TrackPointExtension namespace
- The `<type>` element in `<trk>` is used as a hint for sport type

---

## 8. Recommended Approach for This Project

Given that we have a Polar data export ZIP file and want to get it into Strava, the options are:

### Option A: Convert Polar JSON to TCX (simpler, XML-based)
- Easier to implement in Python/Node.js
- Human-readable output for debugging
- Limited to Running/Biking/Other sport types in the format itself
- Strava will still accept it and you can change type after

### Option B: Convert Polar JSON to FIT (more robust)
- Binary format, slightly more complex to implement
- Supports all sport types natively
- More compact files
- Requires FIT SDK or a library like `fit_tool` (Python) or writing raw binary
- This is what Tredict does

### Option C: Convert Polar JSON to GPX (simplest but limited)
- Only works for GPS-based activities
- No lap data
- Fewer metadata fields

### Recommendation:
**TCX is the best balance** of simplicity and feature support for a custom converter. It's XML (easy to generate), supports HR/cadence/power, multiple laps, and Strava accepts it reliably. For indoor activities without GPS, TCX also works (just omit Position elements).

If you need full sport type support without manual correction in Strava, go with FIT.
