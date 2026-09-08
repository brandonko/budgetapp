# Saved transaction views

On Transactions, save the current applied filters and sort under a name. Open a view to restore description, category/subcategory, account/provider, tags and Any/All mode, group, excluded-row visibility, dates and sorting. Update selected replaces the saved query; Rename changes its name; Delete asks for confirmation.

Choose fixed dates or a rolling range (this month, last month, last 30 days, this year, all time). Rolling ranges resolve using the device's local date whenever the view is opened. Filter edits remain temporary until explicitly saved. Up to 50 named views live in this browser; clearing browser data removes them. No transactions or server files are changed.

Motivation: users describe repeatedly rebuilding tag/date filters in [this saved-view request](https://www.reddit.com/r/MonarchMoney/comments/1ml5rz1) and [this relative-date report request](https://www.reddit.com/r/MonarchMoney/comments/1awfwgj). [Actual's saved filters](https://actualbudget.org/docs/transactions/filters/) corroborate the workflow. These are qualitative examples, not a representative survey.

Validation: `node --test tests/test_saved_views.js tests/test_transactions_controller.js tests/test_transactions_model.js` and the Python regression suite.
