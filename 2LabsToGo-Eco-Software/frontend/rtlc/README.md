# rTLC

With Docker running, launch this folder from Bash with `./run.bash` or from
any POSIX shell with `./run.sh`. Open http://localhost:3102.

Upload one or more plate images to analyze tracks, extract bands, and generate clustering results.

Both launchers build and start this app's frontend and Django API.
Pass `-d` to run in the background. Run `docker compose down` from this
folder to stop the app. Set `PORT` to override the default host port.

The first build installs CPU PyTorch. The app includes the FastSAM segmentation
and autoencoder clustering weights. The Compose volume retains generated rTLC
files and the SQLite database when the containers are recreated.
