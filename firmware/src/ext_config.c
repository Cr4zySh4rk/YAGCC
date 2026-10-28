#include "ext_config.h"
#include <string.h>
#include "idle_sleep.h"

ext_config_t g_ext;

uint32_t yacc_crc32(const uint8_t *d, size_t n) {
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < n; i++) {
        c ^= d[i];
        for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (-(int32_t)(c & 1)));
    }
    return ~c;
}

void ext_seal(ext_config_t *e) {
    e->magic = EXT_MAGIC;
    e->version = EXT_VERSION;
    e->crc = yacc_crc32((const uint8_t *)e, offsetof(ext_config_t, crc));
}

void ext_defaults(ext_config_t *e) {
    memset(e, 0, sizeof(*e));
    memset(e->pin_ext, PIN_NONE, sizeof(e->pin_ext));
    e->rsv1 = 0xFF;
    e->stick_x_ch = e->stick_y_ch = PIN_NONE;
    e->stick_deadzone = 10;
    e->x_min = e->y_min = 0;
    e->x_mid = e->y_mid = 2048;
    e->x_max = e->y_max = 4095;
    memset(e->map, MAP_DEFAULT, sizeof(e->map));
    ext_seal(e);
}

// GPIOs the main config puts to use (a USB host port takes D+ and the next pin)
bool ext_pin_used_by_main(const yacc_config_t *c, uint8_t g) {
    if (g == PIN_NONE) return false;
    for (int i = 0; i < NUM_FUNCS; i++) if (c->pins[i] == g) return true;
    const uint8_t one[] = {c->tilt_pin, c->rgb_pin, c->led_clk_pin, c->host_dp_pin, c->rumble_pin, c->ps2_att, c->ps2_cmd,
                           c->ps2_dat, c->ps2_clk, c->ps2_ack, c->wii_sda, c->wii_scl, c->accel_sda, c->accel_scl};
    for (unsigned i = 0; i < sizeof(one); i++) if (one[i] == g) return true;
    return c->host_dp_pin != PIN_NONE && (unsigned)c->host_dp_pin + 1 == g;
}

bool ext_validate(const ext_config_t *e, const yacc_config_t *main) {
    if (e->magic != EXT_MAGIC || e->version != EXT_VERSION) return false;
    if (e->crc != yacc_crc32((const uint8_t *)e, offsetof(ext_config_t, crc))) return false;
    for (int i = 0; i < NUM_EXT_PINS; i++) {
        uint8_t p = e->pin_ext[i];
        if (p == PIN_NONE) continue;
        if (p >= NUM_DIGITAL_PINS) return false;
        for (int j = 0; j < i; j++) if (e->pin_ext[j] == p) return false;
        if (main && ext_pin_used_by_main(main, p)) return false;
    }
    const uint8_t ch[2] = {e->stick_x_ch, e->stick_y_ch};
    for (int i = 0; i < 2; i++) {
        if (ch[i] == PIN_NONE) continue;
        if (ch[i] >= NUM_ADC_CH) return false;
        if (main) {
            if (main->whammy_ch == ch[i]) return false;
            for (int k = 0; k < NUM_ATILT; k++) if (main->atilt[k].ch == ch[i]) return false;   // ATILT_SRC_ADC0..2 are 0..2
        }
    }
    if (ch[0] != PIN_NONE && ch[0] == ch[1]) return false;
    if (e->stick_deadzone > 50) return false;
    if (!(e->x_min < e->x_mid && e->x_mid < e->x_max && e->x_max <= 4095)) return false;
    if (!(e->y_min < e->y_mid && e->y_mid < e->y_max && e->y_max <= 4095)) return false;
    for (int i = 0; i < 3; i++) if (e->curve[i] < -100 || e->curve[i] > 100) return false;
    for (int i = 0; i < 4; i++) if (e->range[i] > 1) return false;
    if (!bt_sleep_valid(e->bt_sleep)) return false;
    for (int r = 0; r < EXT_MAP_ROWS; r++)
        for (int c = 0; c < EXT_MAP_COLS; c++) {
            uint8_t v = e->map[r][c];
            if (v >= NUM_OUT && v != MAP_DEFAULT) return false;
        }
    return true;
}
