# Quant TLC

With Docker running, launch this folder from Bash with `./run.bash` or from
any POSIX shell with `./run.sh`. Open http://localhost:3101.

Choose a plate image and click **Load plate**, then proceed through preprocessing, integration, and calibration.

Both launchers build and start this app's frontend and Django API.
Pass `-d` to run in the background. Run `docker compose down` from this
folder to stop the app. Set `PORT` to override the default host port.
