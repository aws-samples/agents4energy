# GIS Map Visualization: Wilson Tract Lease Position

## Map Metadata
- **Project Name:** Wilson 1H Development Project
- **Map ID:** MAP-EDDY-2023-0142
- **Date Created:** August 15, 2023
- **Created By:** Sarah Thompson, GIS Specialist
- **Coordinate System:** NAD83 / UTM Zone 13N
- **Data Sources:** 
  - Company Lease Records
  - Eddy County Records
  - USGS Topographic Data
  - NM State Land Office Data

## Map Configuration

```json
{
  "map_title": "Wilson Tract Lease Position - Eddy County, NM",
  "base_layer": "satellite",
  "dimensions": {
    "width_px": 1200,
    "height_px": 900,
    "dpi": 300
  },
  "extent": {
    "xmin": -104.5232,
    "ymin": 32.4121,
    "xmax": -104.4982,
    "ymax": 32.4321
  },
  "layers": [
    {
      "name": "Base Map",
      "type": "tile",
      "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      "opacity": 1.0,
      "visible": true
    },
    {
      "name": "Township/Range Grid",
      "type": "vector",
      "url": "gs://a4e-land-data/tr_grid_eddy_county.geojson",
      "style": {
        "stroke": "#ffff00",
        "stroke-width": 1,
        "stroke-opacity": 0.8,
        "fill": false
      },
      "visible": true
    },
    {
      "name": "Section Grid",
      "type": "vector",
      "url": "gs://a4e-land-data/section_grid_eddy_county.geojson",
      "style": {
        "stroke": "#ff9900",
        "stroke-width": 0.5,
        "stroke-opacity": 0.6,
        "fill": false
      },
      "visible": true
    },
    {
      "name": "Wilson Tract",
      "type": "vector",
      "data": {
        "type": "Feature",
        "geometry": {
          "type": "Polygon",
          "coordinates": [[
            [-104.5172, 32.4271],
            [-104.5042, 32.4271],
            [-104.5042, 32.4171],
            [-104.5172, 32.4171],
            [-104.5172, 32.4271]
          ]]
        },
        "properties": {
          "tract_name": "Wilson",
          "acres": 160.00,
          "section": 8,
          "township": "22S",
          "range": "27E"
        }
      },
      "style": {
        "stroke": "#ff0000",
        "stroke-width": 2,
        "stroke-opacity": 1,
        "fill": true,
        "fill-color": "#ff0000",
        "fill-opacity": 0.2
      },
      "visible": true,
      "label": {
        "field": "tract_name",
        "font": "12px Arial",
        "color": "#ffffff",
        "halo": {
          "color": "#000000",
          "width": 2
        }
      }
    },
    {
      "name": "Nearby Leases",
      "type": "vector",
      "url": "gs://a4e-land-data/leases_eddy_county.geojson",
      "filter": [
        "all",
        ["==", "township", "22S"],
        ["==", "range", "27E"],
        ["in", "section", 5, 6, 7, 8, 9, 17, 18]
      ],
      "style": {
        "stroke": "#00aaff",
        "stroke-width": 1,
        "stroke-opacity": 0.8,
        "fill": true,
        "fill-color": [
          "match",
          ["get", "operator"],
          "Permian Exploration Partners", "#00ff00",
          "Desert Oil Inc.", "#0000ff",
          "Southwestern Energy", "#ff00ff",
          "Lone Star Resources", "#ffaa00",
          "#888888"
        ],
        "fill-opacity": 0.3
      },
      "visible": true
    },
    {
      "name": "Wellbores",
      "type": "vector",
      "url": "gs://a4e-land-data/wells_eddy_county.geojson",
      "filter": [
        "all",
        [">=", "spud_date", "2020-01-01"],
        ["in", "section", 5, 6, 7, 8, 9, 17, 18],
        ["==", "township", "22S"],
        ["==", "range", "27E"]
      ],
      "style": {
        "circle-radius": 3,
        "circle-color": [
          "match",
          ["get", "status"],
          "ACTIVE", "#00ff00",
          "DRILLING", "#ffaa00",
          "COMPLETED", "#0000ff",
          "P&A", "#ff0000",
          "#000000"
        ],
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff"
      },
      "visible": true,
      "label": {
        "field": "well_name",
        "font": "10px Arial",
        "color": "#ffffff",
        "halo": {
          "color": "#000000",
          "width": 1.5
        },
        "offset": [0, -10]
      }
    },
    {
      "name": "Proposed Wilson 1H",
      "type": "vector",
      "data": {
        "type": "Feature",
        "geometry": {
          "type": "Point",
          "coordinates": [-104.5107, 32.4221]
        },
        "properties": {
          "well_name": "Wilson 1H",
          "status": "PROPOSED",
          "target": "Wolfcamp A",
          "operator": "Permian Exploration Partners"
        }
      },
      "style": {
        "circle-radius": 5,
        "circle-color": "#ff00ff",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff"
      },
      "visible": true,
      "label": {
        "field": "well_name",
        "font": "12px Arial Bold",
        "color": "#ffffff",
        "halo": {
          "color": "#000000",
          "width": 2
        },
        "offset": [0, -15]
      }
    },
    {
      "name": "Surface Facilities",
      "type": "vector",
      "url": "gs://a4e-land-data/facilities_eddy_county.geojson",
      "filter": [
        "all",
        ["in", "section", 5, 6, 7, 8, 9, 17, 18],
        ["==", "township", "22S"],
        ["==", "range", "27E"]
      ],
      "style": {
        "icon-image": [
          "match",
          ["get", "type"],
          "TANK_BATTERY", "tank-battery-icon",
          "SEPARATOR", "separator-icon",
          "COMPRESSOR", "compressor-icon",
          "default-icon"
        ],
        "icon-size": 0.75
      },
      "visible": true
    },
    {
      "name": "Pipelines",
      "type": "vector",
      "url": "gs://a4e-land-data/pipelines_eddy_county.geojson",
      "filter": [
        "all",
        ["in", "section", 5, 6, 7, 8, 9, 17, 18],
        ["==", "township", "22S"],
        ["==", "range", "27E"]
      ],
      "style": {
        "stroke": [
          "match",
          ["get", "type"],
          "GAS", "#00ff00",
          "OIL", "#000000",
          "WATER", "#0000ff",
          "#888888"
        ],
        "stroke-width": 1.5,
        "stroke-opacity": 0.7,
        "stroke-dasharray": [
          "match",
          ["get", "status"],
          "PROPOSED", [4, 4],
          "ACTIVE", [1, 0],
          [1, 0]
        ]
      },
      "visible": true
    }
  ],
  "legend": {
    "title": "Legend",
    "items": [
      {
        "label": "Wilson Tract",
        "symbol": "square",
        "fill": "#ff0000",
        "stroke": "#ff0000",
        "stroke-width": 1,
        "fill-opacity": 0.2
      },
      {
        "label": "PEP Leases",
        "symbol": "square",
        "fill": "#00ff00",
        "stroke": "#00aaff",
        "stroke-width": 1,
        "fill-opacity": 0.3
      },
      {
        "label": "Other Operator Leases",
        "symbol": "square",
        "fill": "#888888",
        "stroke": "#00aaff",
        "stroke-width": 1,
        "fill-opacity": 0.3
      },
      {
        "label": "Proposed Well",
        "symbol": "circle",
        "fill": "#ff00ff",
        "stroke": "#ffffff",
        "stroke-width": 1,
        "radius": 5
      },
      {
        "label": "Active Well",
        "symbol": "circle",
        "fill": "#00ff00",
        "stroke": "#ffffff",
        "stroke-width": 1,
        "radius": 3
      }
    ]
  }
}
```

## Map Description

This map displays the Wilson Tract lease position in Section 8, Township 22 South, Range 27 East, NMPM, Eddy County, New Mexico. The Wilson Tract is highlighted in red and consists of the NE/4 of Section 8 (160 acres).

Key features shown on this map include:

1. **Wilson Tract Boundary** - Outlined in red with semi-transparent fill
2. **Surrounding Leases** - Color-coded by operator:
   - Green: Permian Exploration Partners (PEP)
   - Blue: Desert Oil Inc.
   - Magenta: Southwestern Energy
   - Orange: Lone Star Resources
   - Gray: Other operators
3. **Wellbores** - Displayed as circles with colors indicating status:
   - Green: Active producing wells
   - Orange: Wells currently being drilled
   - Blue: Completed wells awaiting production
   - Red: Plugged and abandoned wells
4. **Proposed Wilson 1H Well** - Magenta circle with label
5. **Surface Facilities** - Icons representing tank batteries, separators, and compressors
6. **Pipelines** - Color-coded by type (gas, oil, water) with solid lines for existing pipelines and dashed lines for proposed pipelines

The map shows that PEP has a strong lease position in the area, with contiguous acreage in Sections 7, 8, and 9. The proposed Wilson 1H well is strategically located to develop the Wolfcamp A formation while maintaining appropriate spacing from existing wellbores.

## Data Table: Surrounding Lease Information

| Lease ID | Operator | Section | Acres | Expiration | Royalty | HBP Status |
|----------|----------|---------|-------|------------|---------|------------|
| EDDY-2023-0142 | PEP | 8 (NE/4) | 160.00 | 06/12/2026 | 20% | Undrilled |
| EDDY-2022-0897 | PEP | 7 (E/2) | 320.00 | 11/15/2025 | 20% | HBP |
| EDDY-2022-1234 | PEP | 9 (W/2) | 320.00 | 03/20/2025 | 18.75% | HBP |
| EDDY-2021-0456 | Desert Oil | 17 (N/2) | 320.00 | 05/01/2024 | 25% | HBP |
| EDDY-2023-0088 | Southwestern | 5 (All) | 640.00 | 01/15/2026 | 20% | Undrilled |
| EDDY-2021-1567 | Lone Star | 18 (E/2) | 320.00 | 08/30/2024 | 19% | HBP |

## Interactive Features

When this map is displayed in the interactive viewer, users can:
1. Toggle layer visibility by clicking on layer names in the legend
2. Click on leases to view detailed lease information
3. Click on wells to view production history and well details
4. Zoom in/out to see more or less detail
5. Export the map as PDF, PNG, or JPG
6. Print the map with custom layout options
7. Measure distances and areas using the measurement tools

## Integration

This map integrates with the Land Agent's knowledge base to provide visual context for the Wilson Tract. When users ask questions about lease positions, offset operators, or well spacing, the agent can reference this map to provide visual representations alongside textual responses. 