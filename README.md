## geoscreenshots

Command-line tool to generate Street View screenshots from coordinates (lat/lng), tailored for creating assets and covers for GeoGuessr maps.

It can generate images via:
- Static Street View API (default: fast and reliable)
- Headless browser capture (Puppeteer) for cases the API does not cover

Images are saved as JPEG with options for size, fit, orientation, and naming.

## Requirements

- Yarn 1.x or 3.x
- Bun installed (the script runs with `bun`): `brew install oven-sh/bun/bun`
- Node.js compatible with dependencies (used by Puppeteer)
- Google Maps API key with Street View Static API access

## Installation

```bash
yarn install
```

## API key configuration

Set `GOOGLE_MAPS_API_KEY` or pass `--key` on execution.

You may also use a `.env` file:

```env
GOOGLE_MAPS_API_KEY=YOUR_TOKEN_HERE
```

And load it with `--env` pointing to the file.

## Map format (`map.json`)

The file must contain an array of coordinates. Supported item formats:

- Array: `[lat, lng]`
- Object: `{ "lat": number, "lng": number, "heading?": number, "pitch?": number, "fov?": number, "size?": "WxH" }`

Minimal example:

```json
[
  [-23.55052, -46.633308],
  { "lat": 37.8199286, "lng": -122.4782551, "heading": 120, "size": "1920x1080" }
]
```

## Quick start

```bash
# Generate 5 random images from map.json into ./screenshots
yarn screenshot -- --map ./map.json --count 5 --out ./screenshots
```

If you prefer to pass the key via argument:

```bash
yarn screenshot -- --map ./map.json --count 5 --key "$GOOGLE_MAPS_API_KEY"
```

## Capture modes

- API (default): uses Street View Static API, respects the logical 640 px cap and resizes with `sharp` to reach the desired final size.
- Browser: `--mode=browser` uses Puppeteer to render the panorama and take a screenshot. Useful when the API does not cover a location.

Example (browser mode):

```bash
yarn screenshot -- --map ./map.json --count 2 --mode=browser --size 1920x1080
```

## Arguments

- **--env**: path to a `.env` file to load
- **--key**: Google Maps key (fallback: `GOOGLE_MAPS_API_KEY`)
- **--map**: path to `map.json` (default: `./map.json`)
- **--count**: number of images to generate (default: 2)
- **--size**: final image size, `WxH` (default: `1920x1080`)
- **--scale**: 1 or 2; logical scale for the API (1/2). If omitted, it is inferred from requested size
- **--heading**: direction in degrees (default: 0)
- **--pitch**: tilt (default: 0)
- **--fov**: field of view (default: 90)
- **--radius**: panorama search radius (default: 100)
- **--source**: panorama source (`outdoor` by default)
- **--out**: output directory (default: `./screenshots`)
- **--name**: filename prefix; if missing, uses `lat_lng_timestamp`
- **--fit**: resize strategy with `sharp` (`cover`, `contain`, `fill`, `inside`, `outside`; default: `cover`)
- **--mode**: `api` (default) or `browser`
- **--verbose**: verbose logs

## Examples

```bash
# 10 images at 1080p using API with a fixed heading
yarn screenshot -- --map ./map.json --count 10 --size 1920x1080 --heading 45 --out ./shots

# Honor API logical 640 cap with scale 2, then resize to 4K
yarn screenshot -- --map ./map.json --count 3 --size 3840x2160 --scale 2 --fit contain

# Load a specific .env file
yarn screenshot -- --env ./local.env --map ./map.json --count 2

# Capture via headless browser
yarn screenshot -- --map ./map.json --count 2 --mode=browser --pitch -10 --fov 80
```

## API limits

- The Static Street View API caps the logical dimension at 640 px (width/height). The tool computes logical dimensions and uses `sharp` to reach the requested final size.
- Using the API consumes credits. Check costs and quotas in Google Cloud Console.

## Troubleshooting

- Image processing errors: ensure `sharp` is installed; on Apple Silicon, optional packages are already declared in `package.json`.
- `bun` not found: install with `brew install oven-sh/bun/bun` and verify `bun --version`.
- Puppeteer fails in browser mode: try again with `--mode=api` or check network/permissions.

## Development

```bash
# Type checking
yarn typecheck
```

## Commit conventions

This project follows Conventional Commits. Use messages like:

```text
docs: add English README for GeoGuessr screenshots

feat(cli): support passing --scale to influence logical API size

fix(browser): wait for canvas before capturing when not using embed
```

Reference: https://www.conventionalcommits.org/

## License

ISC


