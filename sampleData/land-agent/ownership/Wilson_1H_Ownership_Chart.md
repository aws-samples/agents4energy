# Wilson 1H Well Ownership Visualization

## Ownership Chart Data

```json
{
  "chart_title": "Wilson 1H Well - Ownership Distribution",
  "chart_subtitle": "Eddy County, NM - Section 8, T22S, R27E",
  "last_updated": "2023-08-20",
  "prepared_by": "Michael Rodriguez, Land Analyst",
  "chart_type": "pie",
  "well_data": {
    "well_name": "Wilson 1H",
    "api": "30-015-45678",
    "operator": "Permian Exploration Partners, LLC",
    "location": "SE/4 NE/4 Section 8, T22S, R27E",
    "target_formation": "Wolfcamp A",
    "well_type": "Horizontal",
    "lateral_length": 10280,
    "status": "Proposed"
  },
  "datasets": [
    {
      "name": "Working Interest",
      "description": "Working Interest distribution among all partners",
      "data": [
        {
          "label": "Permian Exploration Partners",
          "value": 65.0,
          "color": "#3366cc",
          "pattern": "solid"
        },
        {
          "label": "Southwestern Energy",
          "value": 15.0,
          "color": "#dc3912",
          "pattern": "solid"
        },
        {
          "label": "Desert Oil Inc.",
          "value": 10.0,
          "color": "#ff9900",
          "pattern": "solid"
        },
        {
          "label": "BlackRock Energy",
          "value": 5.0,
          "color": "#109618",
          "pattern": "solid"
        },
        {
          "label": "Wilson Family Interests",
          "value": 5.0,
          "color": "#990099",
          "pattern": "solid"
        }
      ],
      "total": 100.0
    },
    {
      "name": "Net Revenue Interest",
      "description": "Net Revenue Interest distribution after royalties",
      "data": [
        {
          "label": "Permian Exploration Partners",
          "value": 52.0,
          "color": "#3366cc",
          "pattern": "solid"
        },
        {
          "label": "Southwestern Energy",
          "value": 12.0,
          "color": "#dc3912",
          "pattern": "solid"
        },
        {
          "label": "Desert Oil Inc.",
          "value": 8.0,
          "color": "#ff9900",
          "pattern": "solid"
        },
        {
          "label": "BlackRock Energy",
          "value": 4.0,
          "color": "#109618",
          "pattern": "solid"
        },
        {
          "label": "Wilson Family Interests",
          "value": 4.0,
          "color": "#990099",
          "pattern": "solid"
        },
        {
          "label": "Wilson Family Royalty",
          "value": 10.0,
          "color": "#0099c6",
          "pattern": "hatch"
        },
        {
          "label": "Other Royalty Owners",
          "value": 10.0,
          "color": "#dd4477",
          "pattern": "hatch"
        }
      ],
      "total": 100.0
    },
    {
      "name": "Royalty Interest Detail",
      "description": "Breakdown of all royalty interests",
      "data": [
        {
          "label": "Sarah J. Wilson",
          "value": 5.0,
          "color": "#0099c6",
          "pattern": "hatch"
        },
        {
          "label": "James T. Wilson",
          "value": 1.67,
          "color": "#66aa00",
          "pattern": "hatch"
        },
        {
          "label": "Rebecca Wilson-Martinez",
          "value": 1.67,
          "color": "#b82e2e",
          "pattern": "hatch"
        },
        {
          "label": "Michael P. Wilson",
          "value": 1.67,
          "color": "#316395",
          "pattern": "hatch"
        },
        {
          "label": "State of New Mexico",
          "value": 3.33,
          "color": "#994499",
          "pattern": "hatch"
        },
        {
          "label": "Johnson Family Trust",
          "value": 3.33,
          "color": "#22aa99",
          "pattern": "hatch"
        },
        {
          "label": "First Baptist Church",
          "value": 3.33,
          "color": "#aaaa11",
          "pattern": "hatch"
        }
      ],
      "total": 20.0
    }
  ],
  "chart_options": {
    "pie": {
      "show_percentages": true,
      "inner_radius": 0,
      "chart_width": 500,
      "chart_height": 400,
      "legend_position": "right"
    },
    "donut": {
      "show_percentages": true,
      "inner_radius": 100,
      "chart_width": 500,
      "chart_height": 400,
      "legend_position": "right"
    },
    "bar": {
      "horizontal": true,
      "stacked": false,
      "show_values": true,
      "chart_width": 600,
      "chart_height": 400,
      "axis_title_x": "Percentage (%)",
      "axis_title_y": "Owner"
    }
  },
  "annotations": [
    {
      "text": "Working Interest Owners are responsible for well costs",
      "position": {"x": 10, "y": 20},
      "font": "12px Arial",
      "color": "#666666"
    },
    {
      "text": "Net Revenue Interest represents revenue distribution",
      "position": {"x": 10, "y": 40},
      "font": "12px Arial",
      "color": "#666666"
    }
  ]
}
```

## Working Interest Distribution

This visualization shows the working interest distribution for the Wilson 1H well, a proposed horizontal well targeting the Wolfcamp A formation in Section 8, Township 22 South, Range 27 East, Eddy County, New Mexico.

### Working Interest Summary Table

| Working Interest Owner | WI Percentage | Net Revenue Interest | Net Acres |
|------------------------|---------------|----------------------|-----------|
| Permian Exploration Partners | 65.00% | 52.00% | 104.00 |
| Southwestern Energy | 15.00% | 12.00% | 24.00 |
| Desert Oil Inc. | 10.00% | 8.00% | 16.00 |
| BlackRock Energy | 5.00% | 4.00% | 8.00 |
| Wilson Family Interests | 5.00% | 4.00% | 8.00 |
| **Total** | **100.00%** | **80.00%** | **160.00** |

### Working Interest Pie Chart

```
                  ╭───────────────────────────╮
                  │   Working Interest (WI)   │
                  ╰───────────────────────────╯
                          Wilson 1H Well
          
          ┌─────────────────────────────────────────┐
          │                                         │
          │                    ,,....,,            │
          │              ,;'        `';,           │
          │            ,;'  Permian    `;,         │
          │           ,;'  Exploration   `;        │
          │          ,;'      Partners     `;      │
          │          ;'         65%         :      │
          │         ;'                      :      │
          │         ;                       :      │
          │         :                       ;      │
          │         :                       ;      │
          │         :          SW          ;'      │
          │         `;        Energy      ;'       │
          │          `;       15%       ,;'        │
          │           `;,             ,;'          │
          │            `;, Desert ,;'  BlackRock   │
          │              `'; 10% ;'      5%        │
          │                 `''''   Wilson 5%      │
          │                                         │
          └─────────────────────────────────────────┘

      ┌─── Permian Exploration Partners (65%)
      │ ┌─ Southwestern Energy (15%)
      │ │ ┌ Desert Oil Inc. (10%)
      │ │ │ ┌ BlackRock Energy (5%)
      │ │ │ │ ┌ Wilson Family Interests (5%)
      ▼ ▼ ▼ ▼ ▼
      █████████████████████████████████████████████████
      ███████████████████████████████████████████████████
```

## Net Revenue Interest Distribution

The following chart shows how revenue from the Wilson 1H well will be distributed after accounting for royalty interests.

### Net Revenue Interest Summary Table

| Interest Type | Owner | NRI Percentage |
|---------------|-------|----------------|
| Working Interest | Permian Exploration Partners | 52.00% |
| Working Interest | Southwestern Energy | 12.00% |
| Working Interest | Desert Oil Inc. | 8.00% |
| Working Interest | BlackRock Energy | 4.00% |
| Working Interest | Wilson Family Interests | 4.00% |
| Royalty Interest | Wilson Family Royalty | 10.00% |
| Royalty Interest | Other Royalty Owners | 10.00% |
| **Total** | | **100.00%** |

### Net Revenue Interest Donut Chart

```
                  ╭───────────────────────────╮
                  │  Net Revenue Interest (NRI)│
                  ╰───────────────────────────╯
                          Wilson 1H Well
          
          ┌─────────────────────────────────────────┐
          │                                         │
          │               ,,........,,              │
          │           ,:'              ':.          │
          │        ,:'                    ':.       │
          │      ,:'                        ':.     │
          │     ,:     Permian                :,    │
          │    ,'     Exploration              ',   │
          │    :      Partners                  :   │
          │   :           52%                    :  │
          │   :                                  :  │
          │   :                                  :  │
          │   :                                  :  │
          │   :         ________                 :  │
          │   :        /        \                :  │
          │    :      / Royalty  \              :   │
          │    ',     \ Interests/             ,'   │
          │     ':.    \________/            ,:'    │
          │       ':.        SW Energy    ,:'       │
          │         ':.        12%      ,:'         │
          │           ':.              ,:'          │
          │             '':..........''             │
          │              Desert    BlackRock        │
          │               8%         4%             │
          │                     Wilson WI 4%        │
          │                                         │
          └─────────────────────────────────────────┘

      ┌─── Permian Exploration Partners (52%)
      │ ┌─ Southwestern Energy (12%)
      │ │ ┌ Desert Oil Inc. (8%)
      │ │ │ ┌ BlackRock Energy (4%)
      │ │ │ │ ┌ Wilson Family Interests WI (4%)
      │ │ │ │ │ ┌ Wilson Family Royalty (10%)
      │ │ │ │ │ │ ┌ Other Royalty Owners (10%)
      ▼ ▼ ▼ ▼ ▼ ▼ ▼
      █████████████████████████████████████████████████
      ███████████████████████████████████████████████████
```

## Detailed Royalty Interest Breakdown

The following chart provides a detailed breakdown of the royalty interests in the Wilson 1H well.

### Royalty Interest Detail Table

| Royalty Owner | Interest Type | Decimal Interest | Percentage |
|---------------|---------------|------------------|------------|
| Sarah J. Wilson | Lessor Royalty | 0.05000 | 5.00% |
| James T. Wilson | Lessor Royalty | 0.01667 | 1.67% |
| Rebecca Wilson-Martinez | Lessor Royalty | 0.01667 | 1.67% |
| Michael P. Wilson | Lessor Royalty | 0.01667 | 1.67% |
| State of New Mexico | ORRI | 0.03333 | 3.33% |
| Johnson Family Trust | ORRI | 0.03333 | 3.33% |
| First Baptist Church | ORRI | 0.03333 | 3.33% |
| **Total Royalty** | | **0.20000** | **20.00%** |

### Royalty Interest Bar Chart

```
╭───────────────────────────────────────────────────────╮
│                Royalty Interest Detail                │
│                    Wilson 1H Well                     │
├───────────────────────────────────────────────────────┤
│                                                       │
│ Sarah J. Wilson      ████████████████████████▌ 5.00%  │
│                                                       │
│ State of NM          █████████████████▌        3.33%  │
│                                                       │
│ Johnson Family       █████████████████▌        3.33%  │
│                                                       │
│ First Baptist        █████████████████▌        3.33%  │
│                                                       │
│ James T. Wilson      ████████▌                 1.67%  │
│                                                       │
│ Rebecca Wilson-M.    ████████▌                 1.67%  │
│                                                       │
│ Michael P. Wilson    ████████▌                 1.67%  │
│                                                       │
╰───────────────────────────────────────────────────────╯
         0%     1%     2%     3%     4%     5%
```

## NRI Calculation Method

The Net Revenue Interest (NRI) for each working interest owner is calculated as follows:

```
NRI = WI × (1 - Total Royalty)

Example for Permian Exploration Partners:
NRI = 65.00% × (1 - 20.00%) = 65.00% × 0.80 = 52.00%
```

## Additional Notes

1. The Wilson 1H well is proposed to be drilled from a surface location in the SE/4 NE/4 of Section 8.
2. All leases contain a 20% royalty rate.
3. No burden exists on Permian Exploration Partners beyond the lessor royalties.
4. The Wilson Family retains both working interest participation rights (5%) and royalty interests (10%).
5. The ORRI (Overriding Royalty Interest) holders acquired their interests through prior assignments.
6. BlackRock Energy farmed into the prospect in May 2023.

## Interactive Features

In the interactive version of this visualization, users can:

1. Toggle between different chart types (pie, donut, bar)
2. Hover over segments to see detailed information
3. Filter by interest type or owner
4. Download data in CSV or Excel format
5. Generate custom reports with selected owners 