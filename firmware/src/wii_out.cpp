// Wii extension output (see wii_out.h)
#include "wii_out.h"
#include "wii_extension_emulation.hpp"
#include "config.h"
#include "accel.h"

static WiiExtensionEmulation *emu;
static uint8_t cur_sda = 0xFF, cur_scl = 0xFF;

extern "C" bool wii_out_pin(int gpio) { return emu && gpio >= 0 && (gpio == cur_sda || gpio == cur_scl); }
extern "C" bool wii_out_active(void) { return emu && emu->is_communicating(); }

static void stop(void) {
    if (!emu) return;
    emu->release(SubType_GuitarHeroGuitar);
    emu->end();
    delete emu;
    emu = nullptr;
    cur_sda = cur_scl = 0xFF;
}

extern "C" void wii_out_task(const uint8_t report[WII_EXT_REPORT_LEN]) {
    uint8_t sda = g_cfg.wii_sda, scl = g_cfg.wii_scl;
    // same pin rules as any RP2040 I2C pair, and not the I2C block the accelerometer uses
    bool ok = accel_pins_ok(sda, scl) &&
              !(accel_pins_ok(g_cfg.accel_sda, g_cfg.accel_scl) && ((g_cfg.accel_sda >> 1) & 1) == ((sda >> 1) & 1));
    if (emu && (!ok || sda != cur_sda || scl != cur_scl)) stop();
    if (!ok) return;
    if (!emu) {
        cur_sda = sda; cur_scl = scl;
        emu = new WiiExtensionEmulation((uint8_t)((sda >> 1) & 1), (int8_t)sda, (int8_t)scl, -1);   // detect wired to 3V3
        emu->acquire();
        emu->begin(SubType_GuitarHeroGuitar);
    }
    emu->update();
    emu->set_inputs((uint8_t *)report, WII_EXT_REPORT_LEN);
}
