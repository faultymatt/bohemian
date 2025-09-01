// dsp/reverb.cpp
#include <cmath>
#include <vector>
#include <algorithm>
#include <cstring>
#include <stdint.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

struct Comb {
  std::vector<float> buf; size_t idx=0; float feedback=0.8f; float damp=0.2f; float fil=0.f;
  void init(int delay){ buf.assign(delay, 0.f); idx=0; fil=0.f; }
  inline float process(float x){
    float y = buf[idx];
    fil = y + (fil - y) * (1.f - damp);   // simple lowpass in feedback
    buf[idx] = x + fil * feedback;
    if(++idx >= buf.size()) idx = 0;
    return y;
  }
};

struct Allpass {
  std::vector<float> buf; size_t idx=0; float fb=0.5f;
  void init(int delay){ buf.assign(delay, 0.f); idx=0; }
  inline float process(float x){
    float y = buf[idx];
    float out = -x + y;
    buf[idx] = x + y * fb;
    if(++idx >= buf.size()) idx = 0;
    return out;
  }
};

struct RevChannel {
  std::vector<Comb> comb; std::vector<Allpass> ap;
  void init(int sr, float room){
    static const int cdel[] = {1116,1188,1277,1356}; // Freeverb基準(48k換算)
    static const int adel[] = {556, 441, 341};
    float scale = (float)sr / 48000.f * std::max(0.2f, room);
    comb.assign(4, {}); ap.assign(3,{});
    for(size_t i=0;i<comb.size();++i){ comb[i].init(std::max(2, (int)std::round(cdel[i]*scale))); }
    for(size_t i=0;i<ap.size();++i){ ap[i].init(std::max(2, (int)std::round(adel[i]*scale))); ap[i].fb = 0.5f; }
  }
  inline float process(float x){
    float s=0.f;
    for(auto &c: comb) s += c.process(x);
    for(auto &a: ap)   s  = a.process(s);
    return s;
  }
};

struct Reverb {
  int sr=48000;
  float room=1.6f, damp=0.2f, mix=0.25f;
  RevChannel L, R;
  void setup(int samplerate){
    sr = samplerate>0? samplerate:48000;
    L.init(sr, room); R.init(sr, room);
    setDamp(damp);
  }
  void setRoom(float r){ room = std::max(0.1f, std::min(r, 4.f)); L.init(sr, room); R.init(sr, room); setDamp(damp); }
  void setDamp(float d){ damp = std::max(0.f, std::min(d, 0.99f)); for(auto &c : L.comb) c.damp = damp; for(auto &c: R.comb) c.damp = damp; }
  void setMix(float m){ mix = std::max(0.f, std::min(m, 1.f)); }

  void process(const float* inL, const float* inR, float* outL, float* outR, int n){
    const float dry = 1.f - mix, wet = mix;
    for(int i=0;i<n;i++){
      float xL = inL? inL[i]:0.f;
      float xR = inR? inR[i]:0.f;
      float yL = L.process(xL);
      float yR = R.process(xR);
      outL[i] = xL * dry + yL * wet;
      outR[i] = xR * dry + yR * wet;
    }
  }
};

static Reverb gRev;

extern "C" {
  __attribute__((used)) void init(int samplerate){ gRev.setup(samplerate); }
  __attribute__((used)) void set_params(float room, float damp, float mix){ gRev.setRoom(room); gRev.setDamp(damp); gRev.setMix(mix); }
  __attribute__((used)) void process(const float* inL, const float* inR, float* outL, float* outR, int n){ gRev.process(inL,inR,outL,outR,n); }
}
