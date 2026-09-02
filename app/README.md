# Ledger budget dashboard

The dashboard reads `processed_data_files/transactions.csv` whenever the browser
requests transaction data. No third-party packages are required.

From the repository root, start it with:

```powershell
python app\server.py
```

Then visit <http://127.0.0.1:8000>.

Use a different CSV or port when needed:

```powershell
python app\server.py --csv path\to\transactions.csv --port 8080
```
