// post_common.glsl：后期类 pass（taa、meter、bloom_down、bloom_up、rain、final）拼在最前（02 第十四节：精度声明、PI、out）
// M1 按 02 的文字写出；E 路可在下面追加后期共用的函数，但不要在这里声明 uniform（各 pass 的主文件自己声明）。
precision highp float; precision highp int; precision highp sampler2D;
#define PI 3.14159265359
layout(location = 0) out vec4 fragColor;
