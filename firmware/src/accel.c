// I2C accelerometer for tilt. Detection, addresses, register setup and the sample filters follow Santroller's
// accelerometerlib (sanjay900/Santroller lib/accelerometer, up to 7a40ba4e "add filters back to
// accelerometers"): LIS3DH / SC7A20 / LIS3DSH, ADXL345, MPU-6050 and its register compatible clones, each set
// up so that 1 g reads as about 16384, polled together with the chip's data ready flag so every sample is
// filtered exactly once, then
//   1. a gravity gate (samples whose total acceleration is too far from 1 g, like a strum bar hit, are
//      dropped and the last good one held, for at most 250 ms),
//   2. a median of the last 3..9 samples,
//   3. a 2nd order Butterworth low pass (Zavalishin's topology preserving state variable filter, its
//      coefficients following the measured sample period),
// each off when its setting is 0. The LIS3DH's three auxiliary ADC inputs are read too.
// Santroller drives the bus from DMA; here each step is one short transfer with a timeout, spread over main
// loop passes (a poll is an 8 byte read, about 0.25 ms at 400 kHz, every 1 ms).
#include "accel.h"
#include "config.h"
#include <math.h>
#include <string.h>
#include "pico/stdlib.h"
#include "hardware/i2c.h"
#include "hardware/gpio.h"

#define ACCEL_I2C_HZ        400000
#define ACCEL_POLL_US       1000      // faster than the chips' 200..400 Hz output, the data ready flag picks new samples
#define ACCEL_PROBE_US      500000    // look for a chip again this often while none answers
#define ACCEL_XFER_US       2000      // per transfer timeout
#define ACCEL_MAX_FAILS     10        // consecutive failed polls before probing again (Santroller: 10)
#define ACCEL_STALE_US      1000000   // no new sample this long: the chip stopped, probe again
#define ACCEL_1G            16384.0f
#define ACCEL_GATE_MAX_US   250000    // stop gating after this long, so constant shaking can't freeze the output
#define ACCEL_RESTART_US    100000    // a gap this long between samples starts the filters again
#define MEDIAN_MAX          9

// LIS3DH family
#define LIS3DH_ADDR1 0x18
#define LIS3DH_ADDR2 0x19
#define LIS3DH_WHOAMI 0x0F
#define LIS3DH_ID  0x33
#define SC7A20_ID  0x11
#define LIS3DSH_ID 0x3F
#define LIS3DH_CTRL1 0x20
#define LIS3DH_CTRL4 0x23
#define LIS3DH_TEMPCFG 0x1F
#define LIS3DH_STATUS_AI (0x27 | 0x80)   // status, then the outputs, auto increment
#define LIS3DH_ZYXDA 0x08
#define LIS3DH_OUTADC1_AI (0x08 | 0x80)
// ADXL345
#define ADXL_ADDR1 0x53
#define ADXL_ADDR2 0x1D
#define ADXL_DEVID 0x00
#define ADXL_ID 0xE5
#define ADXL_BW_RATE 0x2C
#define ADXL_POWER_CTL 0x2D
#define ADXL_INT_SOURCE 0x30             // interrupt source, data format, then the outputs
#define ADXL_DATA_READY 0x80
#define ADXL_DATA_FORMAT 0x31
// MPU-6050
#define MPU_ADDR1 0x68
#define MPU_ADDR2 0x69
#define MPU_WHOAMI 0x75
#define MPU_PWR_MGMT_1 0x6B
#define MPU_ACCEL_CONFIG 0x1C
#define MPU_CONFIG 0x1A
#define MPU_INT_ENABLE 0x38
#define MPU_INT_STATUS 0x3A              // followed by ACCEL_XOUT_H at 0x3B
#define MPU_DATA_RDY 0x01

static i2c_inst_t *bus;
static int8_t cur_sda = -1, cur_scl = -1;
static uint8_t type, addr;
static uint32_t next_us, last_new_us;
static uint8_t fails;
static int32_t accel_out[3];         // filtered, 1 g = 16384
static bool have_sample;
static uint16_t lis_adc[3];          // LIS3DH aux ADC, left justified signed 10 bit
static bool have_adc;

// filter state
static bool filter_started;
static uint32_t last_sample_us, gated_since_us;
static float sample_period, lp_period, lp_a1, lp_a2, lp_a3;
static bool gated;
static int32_t median_ring[3][MEDIAN_MAX];
static uint8_t median_pos, median_n;
static float lp_ic1[3], lp_ic2[3];

uint8_t accel_type(void) { return type; }
bool accel_pin(int gpio) { return gpio >= 0 && (gpio == cur_sda || gpio == cur_scl); }

static int32_t to12(int32_t v) {      // signed 16 bit -> 12 bit reading, 2048 = 0
    v = (v + 32768) >> 4;
    return v < 0 ? 0 : v > 4095 ? 4095 : v;
}
int32_t accel_raw12(int axis) {
    if (!type || !have_sample || axis < 0 || axis > 2) return -1;
    return to12(accel_out[axis]);
}
int32_t accel_adc12(int ch) {
    if (type != ACCEL_LIS3DH || !have_adc || ch < 0 || ch > 2) return -1;
    return to12((int16_t)lis_adc[ch]);
}

static bool wr(uint8_t reg, uint8_t val) {
    uint8_t b[2] = {reg, val};
    return i2c_write_timeout_us(bus, addr, b, 2, false, ACCEL_XFER_US) == 2;
}
static bool rd(uint8_t a, uint8_t reg, uint8_t *dst, size_t n) {
    if (i2c_write_timeout_us(bus, a, &reg, 1, true, ACCEL_XFER_US) != 1) return false;
    return i2c_read_timeout_us(bus, a, dst, n, false, ACCEL_XFER_US) == (int)n;
}

static void clear(void) {
    memset(accel_out, 0, sizeof(accel_out));
    memset(lis_adc, 0, sizeof(lis_adc));
    have_sample = have_adc = false;
    filter_started = false;
}

static void stop_bus(void) {
    if (bus) i2c_deinit(bus);
    for (int i = 0; i < 2; i++) {
        int p = i ? cur_scl : cur_sda;
        if (p >= 0) { gpio_init(p); gpio_set_dir(p, GPIO_IN); gpio_pull_up(p); }   // back to a plain input
    }
    bus = NULL; cur_sda = cur_scl = -1; type = ACCEL_NONE;
    clear();
}

// SDA on an even GPIO and SCL on the odd one of the same I2C block (GP4 / GP5, GP2 / GP3, ...)
bool accel_pins_ok(uint8_t sda, uint8_t scl) {
    return sda < NUM_DIGITAL_PINS && scl < NUM_DIGITAL_PINS && !(sda & 1) && (scl & 1) && ((sda >> 1) & 1) == ((scl >> 1) & 1);
}

static bool setup_chip(uint8_t t) {
    switch (t) {
        case ACCEL_LIS3DH:   // 400 Hz, X/Y/Z on; block update, high resolution, +-2 g; aux ADC on
            return wr(LIS3DH_CTRL1, 0x77) && wr(LIS3DH_CTRL4, 0x88) && wr(LIS3DH_TEMPCFG, 0x80);
        case ACCEL_SC7A20:
            return wr(LIS3DH_CTRL1, 0x77) && wr(LIS3DH_CTRL4, 0x88);
        case ACCEL_LIS3DSH:  // 400 Hz, X/Y/Z on, +-2 g default
            return wr(LIS3DH_CTRL1, 0x7F);
        case ACCEL_ADXL345:  // measure; full resolution +-16 g (4 mg per count); 200 Hz, as fast as it should go
            return wr(ADXL_POWER_CTL, 0x08) && wr(ADXL_DATA_FORMAT, 0x0B) && wr(ADXL_BW_RATE, 0x0B);
        case ACCEL_MPU6050: {  // wake, clock from the X gyro (read back so only sleep / clock change); +-2 g;
            uint8_t v;         // 1 kHz with the 184 Hz low pass; data ready flag on (it is only raised when enabled)
            if (!rd(addr, MPU_PWR_MGMT_1, &v, 1)) return false;
            return wr(MPU_PWR_MGMT_1, (uint8_t)((v & ~0x47) | 0x01)) && wr(MPU_ACCEL_CONFIG, 0x00) &&
                   wr(MPU_CONFIG, 0x01) && wr(MPU_INT_ENABLE, MPU_DATA_RDY);
        }
    }
    return false;
}

static void probe(void) {
    static const uint8_t lis[] = {LIS3DH_ADDR1, LIS3DH_ADDR2}, adxl[] = {ADXL_ADDR1, ADXL_ADDR2}, mpu[] = {MPU_ADDR1, MPU_ADDR2};
    uint8_t id, t = ACCEL_NONE;
    for (int i = 0; i < 2 && !t; i++) {
        if (rd(lis[i], LIS3DH_WHOAMI, &id, 1)) {
            if (id == LIS3DH_ID) t = ACCEL_LIS3DH;
            else if (id == SC7A20_ID) t = ACCEL_SC7A20;
            else if (id == LIS3DSH_ID) t = ACCEL_LIS3DSH;
            if (t) addr = lis[i];
        }
    }
    for (int i = 0; i < 2 && !t; i++)
        if (rd(adxl[i], ADXL_DEVID, &id, 1) && id == ADXL_ID) { t = ACCEL_ADXL345; addr = adxl[i]; }
    for (int i = 0; i < 2 && !t; i++)
        if (rd(mpu[i], MPU_WHOAMI, &id, 1) && (id == 0x68 || id == 0x98 || id == 0x70)) { t = ACCEL_MPU6050; addr = mpu[i]; }
    if (t && setup_chip(t)) { type = t; fails = 0; clear(); last_new_us = time_us_32(); }
}

static void filter_sample(const int32_t a[3], uint32_t t) {
    float out[3] = {(float)a[0], (float)a[1], (float)a[2]};
    uint32_t dt = t - last_sample_us;
    uint8_t median = g_cfg.accel_median > 1 ? (g_cfg.accel_median > MEDIAN_MAX ? MEDIAN_MAX : g_cfg.accel_median) : 0;
    if (!filter_started || dt > ACCEL_RESTART_US || median != median_n) {
        filter_started = true;
        last_sample_us = t;
        sample_period = 0;
        gated = false;
        median_pos = 0;
        median_n = median;
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < MEDIAN_MAX; j++) median_ring[i][j] = a[i];
            lp_ic1[i] = 0;
            lp_ic2[i] = out[i];
            accel_out[i] = a[i];
        }
        have_sample = true;
        return;
    }
    last_sample_us = t;
    // samples are timestamped when the poll that found them finishes, so smooth out that jitter
    sample_period = sample_period ? sample_period + ((float)dt - sample_period) * 0.05f : (float)dt;
    if (g_cfg.accel_gate) {
        float tol = g_cfg.accel_gate / 100.0f;
        float mag = sqrtf(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
        if (fabsf(mag - ACCEL_1G) > tol * ACCEL_1G) {
            if (!gated) { gated = true; gated_since_us = t; }
            if (t - gated_since_us < ACCEL_GATE_MAX_US) return;   // hold the last good sample
        } else {
            gated = false;
        }
    }
    if (median) {
        for (int i = 0; i < 3; i++) {
            median_ring[i][median_pos] = a[i];
            int32_t s[MEDIAN_MAX];
            memcpy(s, median_ring[i], median * sizeof(int32_t));
            for (int x = 1; x < median; x++) {          // insertion sort, at most 9 values
                int32_t v = s[x]; int y = x - 1;
                while (y >= 0 && s[y] > v) { s[y + 1] = s[y]; y--; }
                s[y + 1] = v;
            }
            out[i] = (float)s[median / 2];
        }
        median_pos = (uint8_t)((median_pos + 1) % median);
    }
    if (g_cfg.accel_lowpass) {
        if (fabsf(sample_period - lp_period) > lp_period * 0.01f) {
            lp_period = sample_period;
            float w = (float)M_PI * g_cfg.accel_lowpass * sample_period / 1000000.0f;
            float g = tanf(w < 0.45f * (float)M_PI ? w : 0.45f * (float)M_PI);
            float k = (float)M_SQRT2;
            lp_a1 = 1.0f / (1.0f + g * (g + k));
            lp_a2 = g * lp_a1;
            lp_a3 = g * lp_a2;
        }
        for (int i = 0; i < 3; i++) {
            float v3 = out[i] - lp_ic2[i];
            float v1 = lp_a1 * lp_ic1[i] + lp_a2 * v3;
            float v2 = lp_ic2[i] + lp_a2 * lp_ic1[i] + lp_a3 * v3;
            lp_ic1[i] = 2 * v1 - lp_ic1[i];
            lp_ic2[i] = 2 * v2 - lp_ic2[i];
            out[i] = v2;
        }
    }
    for (int i = 0; i < 3; i++) accel_out[i] = lrintf(out[i]);
    have_sample = true;
}

static void poll(uint32_t now) {
    uint8_t b[8];
    int32_t a[3];
    bool ok, fresh;
    switch (type) {
        case ACCEL_ADXL345:     // interrupt source, data format, X0..Z1; 4 mg per count -> 1 g = 16384
            ok = rd(addr, ADXL_INT_SOURCE, b, 8);
            fresh = b[0] & ADXL_DATA_READY;
            for (int i = 0; i < 3; i++) a[i] = (int16_t)(b[2 + 2 * i] | b[3 + 2 * i] << 8) * 64;
            break;
        case ACCEL_MPU6050:     // int status, then X/Y/Z big endian
            ok = rd(addr, MPU_INT_STATUS, b, 7);
            fresh = b[0] & MPU_DATA_RDY;
            for (int i = 0; i < 3; i++) a[i] = (int16_t)(b[1 + 2 * i] << 8 | b[2 + 2 * i]);
            break;
        default:                // LIS3DH family: status, then X/Y/Z little endian, left justified
            ok = rd(addr, LIS3DH_STATUS_AI, b, 7);
            fresh = b[0] & LIS3DH_ZYXDA;
            for (int i = 0; i < 3; i++) a[i] = (int16_t)(b[1 + 2 * i] | b[2 + 2 * i] << 8);
            break;
    }
    if (!ok) {
        if (++fails > ACCEL_MAX_FAILS) { type = ACCEL_NONE; clear(); }   // unplugged: look again
        return;
    }
    fails = 0;
    if (fresh) {
        for (int i = 0; i < 3; i++) { if (a[i] > 32767) a[i] = 32767; if (a[i] < -32768) a[i] = -32768; }
        filter_sample(a, now);
        last_new_us = now;
    } else if (now - last_new_us > ACCEL_STALE_US) {
        type = ACCEL_NONE; clear();                 // answering but no longer sampling: set it up again
        return;
    }
    if (type == ACCEL_LIS3DH && rd(addr, LIS3DH_OUTADC1_AI, b, 6)) {
        for (int i = 0; i < 3; i++) lis_adc[i] = (uint16_t)(b[2 * i] | b[2 * i + 1] << 8);
        have_adc = true;
    }
}

void accel_task(void) {
    uint8_t sda = g_cfg.accel_sda, scl = g_cfg.accel_scl;
    if (!accel_pins_ok(sda, scl)) { if (bus) stop_bus(); return; }
    if (!bus || sda != cur_sda || scl != cur_scl) {      // first start, or the pins changed in the configurator
        if (bus) stop_bus();
        bus = ((sda >> 1) & 1) ? i2c1 : i2c0;
        i2c_init(bus, ACCEL_I2C_HZ);
        gpio_set_function(sda, GPIO_FUNC_I2C);
        gpio_set_function(scl, GPIO_FUNC_I2C);
        gpio_pull_up(sda);                               // modules have their own pull-ups; these help bare chips
        gpio_pull_up(scl);
        cur_sda = (int8_t)sda; cur_scl = (int8_t)scl;
        type = ACCEL_NONE;
        next_us = time_us_32();
    }
    uint32_t now = time_us_32();
    if ((int32_t)(now - next_us) < 0) return;
    if (!type) { probe(); next_us = time_us_32() + (type ? ACCEL_POLL_US : ACCEL_PROBE_US); return; }
    poll(now);
    next_us = now + ACCEL_POLL_US;
}
