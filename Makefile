uuid := paste-modifier@na0x2c6.com

THIS_DIR := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
SCHEMES_DIR := $(THIS_DIR)/schemas

gschemas-compiled := $(SCHEMES_DIR)/gschemas.compiled
gschema-xml := $(SCHEMES_DIR)/org.gnome.shell.extensions.paste-modifier.gschema.xml

GLIB_COMPILE_SCHEMAS := glib-compile-schemas
DBUS_RUN_SESSION := dbus-run-session
GNOME_EXTENSIONS := gnome-extensions

.PHONY: all
all: $(gschemas-compiled)

-include conf.mk

$(gschemas-compiled): $(gschema-xml)
	$(GLIB_COMPILE_SCHEMAS) $(SCHEMES_DIR)

.PHONY: dev
dev:
	$(DBUS_RUN_SESSION) gnome-shell --devkit --wayland


.PHONY: ext-enable
ext-enable:
	$(GNOME_EXTENSIONS) enable $(uuid)
