# Ledger on a Proxmox Debian VM

Run Ledger in a separate VM, with the browser extension installed on each
computer you import from. These instructions are for access on your trusted
home network. Ledger currently has no login: do not forward port 8000 through
your router to the internet.

## 1. Create the VM

1. Download the current stable **amd64 netinst ISO** from
   [Debian](https://www.debian.org/distrib/netinst) and upload it to your Proxmox
   ISO storage.
2. Choose **Create VM** in Proxmox. Name it `ledger`, select the Debian ISO,
   and use **1 CPU core, 1 GB RAM, and a 16 GB disk** as a starting allocation.
   Connect its virtual network adapter to your home-network bridge (usually
   `vmbr0`; check the bridge your Home Assistant VM uses).
3. Install Debian with **SSH server** and **standard system utilities** selected,
   and the graphical desktop unchecked. Create an administrative user. Leaving
   the installer's root password blank gives that first user sudo access.
4. Start the VM and enable **Start at boot** in its Proxmox options. Inside it,
   run `hostname -I` to find its LAN address. Reserve that address for the VM in
   your router's DHCP settings so the extension's trusted address stays valid.

These are small-workload starting resources, not a Proxmox minimum. See the
[Proxmox administration guide](https://pve.proxmox.com/pve-docs/pve-admin-guide.pdf)
for VM and bridge configuration.

## 2. Install Ledger once

In the Debian VM, install Python, Node.js, and the server utilities:

```sh
sudo apt update
sudo apt install -y python3 nodejs git openssh-server qemu-guest-agent
sudo systemctl enable --now ssh qemu-guest-agent
```

Deployment verification requires **Python 3.10+ and Node.js 22+**. Check
`python3 --version` and `node --version` before installing Ledger. If your Debian
release provides an older Node.js package, install a supported version using
the [official Node.js installation instructions](https://nodejs.org/en/download).
Make Node available system-wide to the `ledger` service account; a personal
shell version manager is insufficient for `runuser` during deployment.
Node runs regression tests before a deployment; the Ledger application itself
still runs on Python without third-party packages. Browser test packages and
Chromium are only needed for development/CI, not on the VM.

Enable the QEMU Guest Agent option in Proxmox as well. If its service cannot
start before that option takes effect, restart the VM and start it again.

The repository's branch is **main**, not master. The installer fetches committed
code from GitHub; it does not upload uncommitted edits from your PC. Commit and
push any changes you want deployed first, including the trusted-server extension
settings. Never add `data/` or `raw_data_files/` to Git.

From PowerShell in your local budgetapp repository, copy the deployment files
to the VM. Replace `YOUR_USER` and `YOUR_VM_IP` with the Debian login and address:

```powershell
scp -r .\deploy YOUR_USER@YOUR_VM_IP:~/ledger-setup
ssh -t YOUR_USER@YOUR_VM_IP
```

Then, in that SSH session:

```sh
sudo python3 ~/ledger-setup/ledger_deploy.py --install
```

If the repository is private, configure a **read-only GitHub deploy key** for
root in the VM first, then use the SSH repository URL on the initial install:

```sh
sudo python3 ~/ledger-setup/ledger_deploy.py --install --repository git@github.com:brandonko/budgetapp.git
```

The deploy command runs with sudo, so Git access must work for root. Do not put
a GitHub token in a URL or command line. Repository and branch are saved in
`/etc/ledger-deploy.json`. Use `sudo ledger-deploy` to retry a failed initial
fetch after fixing Git access. The app service itself has no Git credentials.

Open `http://YOUR_VM_IP:8000`. Add that exact address in the extension's
**Ledger connection settings**, approve access, and refresh `/import`.
If the Proxmox firewall is enabled, allow TCP 8000 from your home subnet and
SSH from your administration computer. Use your actual subnet.

## 3. Deploy updates with one command

After changes have been committed and pushed to GitHub's `main`, run this from
PowerShell:

```powershell
ssh -t YOUR_USER@YOUR_VM_IP "sudo ledger-deploy"
```

Or, when already logged into the VM:

```sh
sudo ledger-deploy
```

Finish or cancel import reviews before deploying: restarting clears their
temporary sessions. The command:

- Fetches the latest `main` and stages that exact commit in a new release folder.
- Runs `python3 scripts/verify.py` against synthetic test data before stopping
  the current service. This requires both the Python suite and every JavaScript
  suite, and rejects skipped tests. Missing Node.js or a failed check leaves the
  running app alone.
- Stops Ledger and saves a complete data snapshot under `/var/backups/ledger/`.
- Switches to the new release, starts Ledger, and checks its response on port 8000.
- Leaves Ledger stopped if startup fails, preserves data and its backup, and
  points the release link back at the previous code. It never silently restores
  a database that startup may have migrated.

If the latest commit is already running and healthy, the command does nothing.
Concurrent deployments are blocked. Old releases and deployment backups are
kept; periodically check VM disk space and manage retention deliberately.
Updater/service changes themselves are not automatically installed by code
updates; those files live outside the release and require an explicit admin update.

For an existing VM adopting this verification gate, install Node.js 22+ and
update the installed helper after pulling these deployment files:

```sh
sudo install -m 755 ~/ledger-setup/ledger_deploy.py /usr/local/sbin/ledger-deploy
```

Copy the current `deploy` folder to `~/ledger-setup` first using the earlier
PowerShell command. An older installed helper continues using its old checks
until this explicit update is performed.

The extension is a separate browser installation. Deploying the web app does
not update it: pull the same repository changes on your browsing PC and reload
the unpacked extension in `chrome://extensions` when extension code changes.

## Existing data and backups

The service's database and adjacent settings live in `/var/lib/ledger/`, outside
`/opt/ledger/releases/`. This preserves transactions, taxonomy, classifications,
transfer-review state, and app-managed backups across code updates. An empty
installation waits for an explicitly confirmed import to create the database.

To move your existing local Ledger data, finish edits/imports on the PC and
stop the VM service. Copy the **entire contents of `data/`**, including settings
and backups, to `/var/lib/ledger/`. Set ownership to `ledger:ledger`. Do this
before creating data in the VM; if the VM already has data, make a backup and
choose a migration plan before replacing anything. Keep the PC copy until you
verify the server's totals and settings.

Use Proxmox scheduled VM backups to storage outside the VM. The snapshots
inside this VM do not protect against loss of the VM's disk. Before a manual
data restore, stop Ledger and back up the current directory. Restoring older
data is a separate explicit operation, not part of routine code deployment.

## Status and troubleshooting

```sh
sudo systemctl status ledger --no-pager
sudo journalctl -u ledger -n 60 --no-pager
sudo cat /opt/ledger/current/.ledger-revision
sudo systemctl restart ledger
```

The service runs under its own unprivileged account and starts at boot. Its
systemd configuration makes code read-only while allowing writes to its state
directory. See [systemd's state-directory documentation](https://manpages.debian.org/bookworm/systemd/systemd.exec.5.en.html).

Setup has to be completed inside an actual Debian VM before end-to-end service,
SSH, firewall, reboot, and browser-extension checks can be confirmed.
