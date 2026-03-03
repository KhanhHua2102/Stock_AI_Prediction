# PowerTrader AI - Remaining Issues & Recommendations

**Last Updated**: January 31, 2026
**System**: PowerTrader AI - Cryptocurrency Trading System
**Target Environment**: Windows PC 24/7, Kraken API, Real Money Trading

---

## 🔴 **REMAINING SECURITY ISSUES**

### 1. **Hardcoded Trading Parameters** ⚠️ **FINANCIAL RISK**

- **Found in `legacy/pt_trader.py`**:
  - DCA levels: Line 242-250 (hardcoded percentages)
  - Allocation: Line 1522 (`0.00005 / len(crypto_symbols)`)
  - Min allocation: Line 1524 (`0.5`)
- **Risk**: May not be appropriate for all market conditions
- **Recommendation**: Make these configurable via settings file

---

## ⚡ **REMAINING PERFORMANCE ISSUES**

### 1. **Excessive API Calls** ⚠️ **MANUAL FIX NEEDED**

- **Issue in `legacy/pt_trader.py:1009-1639`**: Main trading loop runs every 0.5 seconds
- Each iteration makes multiple API calls:
  - `get_account()` → Kraken API call
  - `get_holdings()` → Kraken API call
  - `get_price()` → BTCMarkets API call for each symbol
- **Calculation**: ~6-10 API calls every 0.5 seconds = **12-20 calls/second**
- **Kraken limits**: ~15-20 requests/second, but you'll hit rate limits quickly
- **Fix**:
  ```python
  # Increase sleep interval in pt_trader.py main loop
  time.sleep(5)  # Instead of 0.5 - check every 5 seconds
  ```

---

## 🔧 **REMAINING RELIABILITY ISSUES**

### 1. **Process Crashes Not Handled**

- **Issue**: No watchdog or auto-restart mechanism
- **Risk**: If trader crashes, no trades execute until you manually restart
- **Windows Solutions**:
  - Use Windows Task Scheduler with restart on failure
  - Or create a watchdog service
  - Or use PM2 (Node.js process manager) for Python scripts

---

## 📊 **MODEL TRAINING RECOMMENDATIONS**

### Scheduled Retraining (Recommended for Windows 24/7)

Create a Windows Task Scheduler job:

```batch
# train_scheduler.bat
@echo off
cd C:\path\to\Crypto_Trading_PowerTrade
call venv\Scripts\activate.bat
python legacy\pt_trainer.py
```

**Schedule**:
- **Weekly**: Good for BTC (less volatile patterns)
- **Every 3-5 days**: Better for altcoins (faster pattern changes)
- **Run during low-volatility hours**: 2-4 AM UTC

### Important Considerations

1. **Retraining During Live Trading**:
   - ⚠️ **CRITICAL**: Pause trading during retraining
   - Or: Train in separate directory, atomic swap when complete

2. **Backtesting After Retraining**:
   - Always backtest new model before deploying
   - Compare performance metrics to previous model
   - Keep old model as fallback

---

## 🖥️ **WINDOWS PC 24/7 SETUP**

### 1. Windows Power Settings

```
Control Panel → Power Options → High Performance
- Never sleep
- Never turn off display (or very long timeout)
- Disable "Turn off hard disk after X minutes"
```

### 2. Windows Update Management

```
gpedit.msc → Computer Configuration → Administrative Templates
→ Windows Components → Windows Update
→ "No auto-restart with logged on users" → Enabled
```

### 3. Network Reliability

```
Device Manager → Network Adapters → Properties → Power Management
→ Uncheck "Allow computer to turn off this device"
```

### 4. Automatic Restart on Crash

Create `run_trader.ps1`:

```powershell
while ($true) {
    try {
        Write-Host "Starting PowerTrader..."
        cd "C:\path\to\Crypto_Trading_PowerTrade"
        & ".\venv\Scripts\python.exe" "legacy\pt_trader.py"
    }
    catch {
        Write-Host "Trader crashed, restarting in 10 seconds..."
        Start-Sleep -Seconds 10
    }
}
```

Add to Task Scheduler with "At system startup" trigger.

### 5. Monitoring & Alerts

Set up notifications for:
- System offline > 5 minutes
- No trades executed in 24 hours
- API errors > threshold
- Kraken account balance changes

**Tools**: Telegram Bot, Email via Gmail SMTP

### 6. Backup Strategy

- **Automated backups** of:
  - `data/training/` folder (models)
  - `data/runtime/` folder (trade history)
  - `gui_settings.json`
- **Frequency**: Daily backups to external drive or cloud

### 7. Security for 24/7 Operation

- Enable Windows Firewall
- Block all incoming connections except localhost
- Enable BitLocker for drive encryption
- Use separate Windows user account for trading (not admin)

---

## 🎯 **REMAINING ACTION ITEMS**

### Performance:
1. ⬜ Increase main loop sleep to 5-10 seconds (manual change in pt_trader.py)

### Windows 24/7 Setup:
1. ⬜ Configure power settings
2. ⬜ Disable automatic Windows updates restart
3. ⬜ Set up automatic restart on crash
4. ⬜ Implement monitoring/alerting
5. ⬜ Configure daily backups

### Model Training:
1. ⬜ Set up Windows Task Scheduler for weekly retraining
2. ⬜ Implement training staleness monitoring
3. ⬜ Add model performance tracking
4. ⬜ Create backtest pipeline for new models

---

## 🛡️ **SECURITY CHECKLIST**

Remaining items before going live:

- [ ] Enable Windows Firewall and block all incoming connections
- [ ] Set file permissions on credential files (read-only, current user only)
- [ ] Enable BitLocker or NTFS encryption
- [ ] Create separate Windows user for trading (non-admin)
- [ ] Add HTTPS for web dashboard (if exposing to network)
- [ ] Review and limit Kraken API key permissions (trade only, no withdraw)
- [ ] Set up 2FA on Kraken account
- [ ] Create emergency kill switch mechanism

---

## 📝 **FINAL RECOMMENDATIONS**

1. **START SMALL**: Test with minimum Kraken allows (~$10 AUD) for at least 1-2 weeks
2. **MONITOR ACTIVELY**: First month, check multiple times daily
3. **SET LIMITS**: Configure max position size, max daily trades
4. **KILL SWITCH**: Have a manual emergency stop mechanism
5. **INSURANCE**: Only trade with money you can afford to lose
6. **COMPLIANCE**: Ensure you're complying with Australian tax laws for crypto trading

---

## 📞 **RESOURCES**

- Kraken API: https://docs.kraken.com/rest/
- BTCMarkets API: https://docs.btcmarkets.net/
- Windows Task Scheduler: https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page
- Telegram Bot for Alerts: https://core.telegram.org/bots
