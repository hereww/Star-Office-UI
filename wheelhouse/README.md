# Quickstart wheelhouse

The source tree keeps this directory empty so an online Docker build has a
valid `COPY wheelhouse` context. A distributable offline bundle is generated
with `scripts/package_deploy_bundle.py --wheelhouse PATH`; the builder copies
validated Linux CPython 3.11 wheels into the bundle's `wheelhouse/` directory.
