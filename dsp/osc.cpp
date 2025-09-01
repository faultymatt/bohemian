#include <cmath>
extern "C" {
// Fills buffer with N samples of a basic band-limited-ish saw (naive + soft clip)
void render(float* out, int N, float freq, float sr, float phase_in, float* phase_out){
float p = phase_in;
const float inc = freq / sr;
for(int i=0;i<N;i++){
float x = 2.0f * (p - std::floor(p + 0.5f)); // naive saw [-1,1]
// soft clip
out[i] = tanhf(0.8f * x);
p += inc; if (p>=1.0f) p -= 1.0f;
}
*phase_out = p;
}
}
