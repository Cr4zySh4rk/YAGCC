// I2C accelerometer for tilt (LIS3DH, SC7A20, LIS3DSH, ADXL345, MPU-6050 and clones), detected automatically
// on the SDA / SCL pins set in the configurator. Same chips, addresses and register setup as Santroller.
#ifndef YACC_ACCEL_H_
#define YACC_ACCEL_H_
#include <stdint.h>
#include <stdbool.h>
#ifdef __cplusplus
extern "C" {
#endif

enum { ACCEL_NONE = 0, ACCEL_LIS3DH, ACCEL_ADXL345, ACCEL_MPU6050, ACCEL_SC7A20, ACCEL_LIS3DSH };

void accel_task(void);                 // call from the main loop: (re)starts on pin changes, probes, polls
uint8_t accel_type(void);              // ACCEL_* found, ACCEL_NONE while nothing answers
bool accel_pin(int gpio);              // true for the GPIOs the I2C bus is using (not buttons)
// Filtered acceleration on one axis (0 = X, 1 = Y, 2 = Z) as a 12-bit reading like the analog inputs:
// 2048 = 0 g, 1024 counts per g (every chip is scaled to 1 g = 16384 first). -1 when no chip is connected.
int32_t accel_raw12(int axis);
// LIS3DH auxiliary ADC input 1..3 (ch 0..2) as a 12-bit reading, -1 when not a LIS3DH
int32_t accel_adc12(int ch);
bool accel_pins_ok(uint8_t sda, uint8_t scl);   // SDA even, SCL odd, same I2C block

#ifdef __cplusplus
}
#endif
#endif
