// PS2 controller port output (see ps2_out.h), driving Santroller's PSXEmulation the way its
// Ps2EmulationDeviceInstance does: listen on ATT, take the port once the console polls it, feed reports.
#include "ps2_out.h"
#include "psx_emulation.hpp"
#include "config.h"
#include "rumble.h"
#include <string.h>

static PSXEmulation *emu;
static uint8_t pins[5] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF};   // att, cmd, dat, clk, ack
static bool begun;

extern "C" bool ps2_out_pin(int gpio) {
    if (!emu || gpio < 0) return false;
    for (int i = 0; i < 5; i++) if (pins[i] == gpio) return true;
    return false;
}
extern "C" bool ps2_out_active(void) { return emu && begun; }

static bool pins_valid(const uint8_t *p) {
    for (int i = 0; i < 5; i++) {
        if (p[i] >= NUM_DIGITAL_PINS) return false;
        for (int j = 0; j < i; j++) if (p[i] == p[j]) return false;
    }
    return true;
}

static void stop(void) {
    if (!emu) return;
    if (begun) emu->release();
    emu->end();
    delete emu;
    emu = nullptr;
    begun = false;
    for (int i = 0; i < 5; i++) pins[i] = 0xFF;
}

extern "C" void ps2_out_task(const uint8_t report[PS2_REPORT_LEN], bool allowed) {
    const uint8_t want[5] = {g_cfg.ps2_att, g_cfg.ps2_cmd, g_cfg.ps2_dat, g_cfg.ps2_clk, g_cfg.ps2_ack};
    bool ok = allowed && pins_valid(want);
    if (emu && (!ok || memcmp(want, pins, 5) != 0)) stop();
    if (!ok) return;
    if (!emu) {
        memcpy(pins, want, 5);
        emu = new PSXEmulation((int8_t)pins[3], (int8_t)pins[1], (int8_t)pins[2], pins[0], pins[4]);
        emu->listen();
    }
    emu->tick();
    bool console = emu->is_communicating();
    if (console && !begun) { emu->acquire(); emu->begin(SubType_GuitarHeroGuitar); begun = true; }
    else if (!console && begun) { emu->release(); begun = false; }   // gone: back to listening after the grace time
    if (begun) {
        emu->sendData(PS2_REPORT_LEN, (uint8_t *)report);
        uint8_t small, large;
        emu->get_rumble(small, large);
        rumble_game(large, small ? 255 : 0);
    }
}
