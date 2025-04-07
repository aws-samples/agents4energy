# Energy Trading Portfolio Risk Management Report
**Portfolio ID:** ENGY-PORT-1  
**Reporting Date:** April 5, 2024  
**Analysis Period:** April 1-5, 2024  
**Prepared by:** Risk Management Department

## Executive Summary

The trading portfolio ENGY-PORT-1 currently has a mark-to-market value of $1,363,500 as of April 5, 2024. The portfolio has experienced significant volatility over the past week, with the MTM value ranging from $1,363,500 to $3,529,400. The current 1-day Value at Risk (VaR) at the 95% confidence level is $145,000, indicating that under normal market conditions, we would expect to lose no more than this amount on 95% of trading days.

The portfolio is primarily exposed to WTI crude oil (52% of risk), Brent crude oil (23%), and natural gas (24%). The remaining 1% is attributable to refined products. Our current net delta position stands at +440,425 (long), with significant gamma exposure of +8,300, indicating positive convexity in the options portfolio.

## Value at Risk (VaR) Analysis

### VaR Methodology
- **Model Type:** Historical simulation with EWMA volatility weighting
- **Confidence Level:** 95%
- **Time Horizons:** 1-day, 7-day, and 30-day
- **Historical Data:** 2 years of historical price data
- **Risk Factors:** 15 market factors including outright commodity prices, spreads, volatilities
- **Correlations:** Dynamic correlation matrix updated weekly

### Current VaR Metrics
| Time Horizon | VaR (95%) | VaR (99%) | Expected Shortfall (95%) |
|--------------|-----------|-----------|--------------------------|
| 1-Day        | $145,000  | $210,000  | $185,000                 |
| 7-Day        | $280,000  | $410,000  | $365,000                 |
| 30-Day       | $560,000  | $820,000  | $730,000                 |

### VaR by Risk Factor
| Risk Factor            | 1-Day VaR Contribution | % of Total VaR |
|------------------------|------------------------|----------------|
| WTI Crude Oil Price    | $75,400                | 52.0%          |
| Brent Crude Oil Price  | $33,350                | 23.0%          |
| Natural Gas Price      | $34,800                | 24.0%          |
| Refined Products       | $1,450                 | 1.0%           |
| Time Spreads           | Included above         | -              |
| Volatility             | Included above         | -              |
| **Total**              | **$145,000**           | **100.0%**     |

### VaR Historical Trend
| Date       | 1-Day VaR (95%) | Portfolio MTM  | VaR as % of MTM |
|------------|-----------------|----------------|-----------------|
| 2024-04-01 | $145,000        | $1,563,800     | 9.3%            |
| 2024-04-02 | $148,000        | $2,463,400     | 6.0%            |
| 2024-04-03 | $152,000        | $3,529,400     | 4.3%            |
| 2024-04-04 | $149,000        | $2,767,900     | 5.4%            |
| 2024-04-05 | $145,000        | $1,363,500     | 10.6%           |

## Stress Testing Results

The portfolio has been subjected to various stress scenarios to assess potential impacts of extreme market movements:

### Historical Stress Scenarios
| Scenario                      | Description                                  | P&L Impact    | % of MTM    |
|-------------------------------|----------------------------------------------|---------------|-------------|
| 2008 Financial Crisis         | Replication of 2008 market moves             | -$720,000     | -52.8%      |
| 2014-15 Oil Price Collapse    | 60% decline in crude prices over 6 months    | -$620,000     | -45.5%      |
| 2020 COVID Shock              | March 2020 pandemic market reaction          | -$850,000     | -62.3%      |
| 2022 Ukraine Invasion         | Initial market reaction to conflict          | -$510,000     | -37.4%      |
| 2023 Banking Crisis           | SVB collapse market reaction                 | -$350,000     | -25.7%      |

### Hypothetical Stress Scenarios
| Scenario                      | Description                                  | P&L Impact    | % of MTM    |
|-------------------------------|----------------------------------------------|---------------|-------------|
| Stress Test 1                 | WTI/Brent -15%, Natural gas -20%             | -$420,000     | -30.8%      |
| Stress Test 2                 | WTI/Brent -30%, Natural gas -40%             | -$850,000     | -62.3%      |
| Supply Disruption             | WTI/Brent +25%, Natural gas +15%             | +$680,000     | +49.9%      |
| Recession Scenario            | WTI/Brent -20%, Natural gas -10%             | -$510,000     | -37.4%      |
| Volatility Spike              | 100% increase in implied volatilities        | +$192,000     | +14.1%      |

## Position Analysis

### Net Delta Exposure
| Commodity          | Net Delta         | Delta Limit      | % Utilized    |
|--------------------|-------------------|------------------|---------------|
| WTI Crude Oil      | +190,425 bbls     | ±500,000 bbls    | 38.1%         |
| Brent Crude Oil    | -400,000 bbls     | ±500,000 bbls    | 80.0%         |
| Natural Gas        | +550,000 mmBtu    | ±750,000 mmBtu   | 73.3%         |
| Heating Oil        | +500 bbls         | ±100,000 bbls    | 0.5%          |

### Greeks Analysis (Options Portfolio)
| Greek Measure | Current Value | Limit      | % Utilized |
|---------------|--------------|------------|------------|
| Delta         | +40,425      | ±250,000   | 16.2%      |
| Gamma         | +8,300       | ±25,000    | 33.2%      |
| Vega          | +1,910       | ±10,000    | 19.1%      |
| Theta         | -158         | -1,000     | 15.8%      |

### Maturity Profile
| Time Bucket    | MTM Exposure   | % of Total |
|----------------|----------------|------------|
| 0-1 month      | $567,000       | 41.6%      |
| 1-3 months     | $481,500       | 35.3%      |
| 3-6 months     | $192,500       | 14.1%      |
| 6-12 months    | $122,500       | 9.0%       |
| > 12 months    | $0             | 0.0%       |
| **Total**      | **$1,363,500** | **100.0%** |

## Risk Limit Utilization

| Risk Measure           | Current   | Limit       | % Utilized | Status      |
|------------------------|-----------|-------------|------------|-------------|
| 1-Day VaR (95%)        | $145,000  | $200,000    | 72.5%      | Within limit |
| WTI Delta              | +190,425  | ±500,000    | 38.1%      | Within limit |
| Brent Delta            | -400,000  | ±500,000    | 80.0%      | Within limit |
| Natural Gas Delta      | +550,000  | ±750,000    | 73.3%      | Within limit |
| Maximum Maturity       | 9 months  | 12 months   | 75.0%      | Within limit |
| Concentration (single) | 52.0%     | 60.0%       | 86.7%      | Within limit |
| Options Gamma          | +8,300    | ±25,000     | 33.2%      | Within limit |
| Stress Test Loss       | -$850,000 | -$1,000,000 | 85.0%      | Within limit |

## Risk Management Recommendations

1. **Crude Oil Exposure:** The portfolio has significant long exposure to WTI crude oil and significant short exposure to Brent crude oil, creating a large spread position. While this is within limits, the Brent short position is approaching 80% of the limit. Consider reducing the size of the spread trade by 20-30% if the WTI-Brent differential narrows further.

2. **Natural Gas Exposure:** Natural gas delta exposure is substantial at 73.3% of limit. With summer approaching and potential for increased volatility, consider implementing options collar strategies to reduce outright exposure while maintaining upside potential.

3. **Stress Test Results:** The portfolio is most vulnerable to extreme market selloffs as shown in Stress Test 2 (-$850,000). This represents 85% of our stress loss limit. Recommend purchasing additional downside protection through put options or reducing overall delta exposure by 15-20%.

4. **VaR Trend Analysis:** VaR as a percentage of MTM has increased from 4.3% to 10.6% over the past week due to decreased MTM value while maintaining similar absolute risk. This indicates increasing relative risk in the portfolio. Monitor closely if this trend continues.

5. **Term Structure Exposure:** Current portfolio has limited exposure beyond 6 months (9.0% of MTM). Consider extending a portion of the WTI exposure to longer-dated contracts to diversify term structure risk, particularly given the backwardated market structure.

## Action Items

1. Rebalance WTI-Brent spread position by April 10th
2. Implement natural gas collar strategy before April 15th
3. Purchase additional portfolio protection through put options (5-10% out-of-the-money) by April 8th
4. Review risk limits at next Risk Committee meeting (April 12th)
5. Perform additional scenario analysis on potential summer weather impacts by April 20th

## Appendix: VaR Methodology Details

The Value at Risk (VaR) methodology employed for this portfolio uses a hybrid approach combining historical simulation with EWMA (Exponentially Weighted Moving Average) volatility adjustments. The model parameters include:

- **Historical Data Period:** 2 years (April 2022 - April 2024)
- **Decay Factor (λ):** 0.94
- **Confidence Intervals:** 95% and 99%
- **Distribution Assumption:** Non-parametric (based on historical returns)
- **Backtesting Results:** 7 exceedances in past 250 trading days (within acceptable range)
- **Data Cleaning:** Extreme outliers beyond 5 standard deviations are winsorized
- **Correlation Matrix:** Updated weekly using 120-day rolling window with EWMA weighting

The VaR model has been validated through:
- Daily backtesting
- Quarterly model review
- Annual independent validation
- Stress testing to assess tail risk beyond VaR

Key limitations to consider:
- Historical data may not fully represent future market conditions
- Correlations can break down during extreme market stress
- Liquidity risk is not explicitly captured in the primary VaR model 