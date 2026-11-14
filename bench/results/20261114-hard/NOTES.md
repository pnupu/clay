> **Read with these numbers.** The hard task set was calibrated before this run: each task was tried on
> claude-opus-5-5 and gpt-6-luna (`20261114-hard-calib1`, 16 runs), six tasks that both passed were made
> harder, and four were tried again (`20261114-hard-calib2`, 8 runs). Calibrating on two of the six measured
> models is a form of tuning (see `bench/METHOD.md`). All 3 gpt-6.1-terra failures are one **disputed**
> check (`bank-import`, Nordea amounts with fewer than two decimals, a form the task's docs do not show);
> they count as failures here, and "Disputed failures" below gives the rate without them. The 95%
> intervals treat the 24 runs per model as independent; the 3 repeats of a task are correlated, so the
> real uncertainty is larger.
