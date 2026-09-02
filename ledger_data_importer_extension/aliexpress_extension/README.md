# AliExpress importer

This module reads the signed AliExpress MTop order-list and order-detail APIs using the active
Chrome login. Raw cookies and signing tokens remain inside the extension; only normalized order
and item data is sent to the local Ledger server.

The request and payload behavior is adapted from
[nrbrook/AliExpress-Order-Export](https://github.com/nrbrook/AliExpress-Order-Export), licensed
under the MIT License. See [LICENSE](LICENSE).
