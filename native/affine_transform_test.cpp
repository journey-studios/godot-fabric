#include "affine_transform.h"
#include <iostream>
#include <limits>
#include <string>
#include <vector>

using fabric_godot::affine_factors;
using Matrix = std::array<double, 16>;
static Matrix matrix(double a, double b, double c, double d, double x = 0, double y = 0) {
  return {a,b,0,0,c,d,0,0,0,0,1,0,x,y,0,1};
}
static size_t checks = 0;
static void require(bool condition, const std::string &name) {
  ++checks;
  if (!condition) throw std::runtime_error(name);
}
static void reconstruct(const Matrix &m, bool reflection) {
  const auto f = affine_factors(m);
  const auto ca=std::cos(f.rotation), sa=std::sin(f.rotation);
  const auto cb=std::cos(f.offset_rotation), sb=std::sin(f.offset_rotation);
  const std::array<double,6> rebuilt{
    ca*f.scale_x*cb-sa*f.scale_y*sb,
    sa*f.scale_x*cb+ca*f.scale_y*sb,
    -ca*f.scale_x*sb-sa*f.scale_y*cb,
    -sa*f.scale_x*sb+ca*f.scale_y*cb,
    f.translate_x,f.translate_y};
  const std::array<double,6> expected{m[0],m[1],m[4],m[5],m[12],m[13]};
  const auto norm=std::max({std::abs(m[0]),std::abs(m[1]),std::abs(m[4]),std::abs(m[5])});
  for(size_t i=0;i<6;++i)
    require(std::isfinite(rebuilt[i]) && std::abs(rebuilt[i]-expected[i]) <= norm*2e-12,
      "Affine reconstruction component "+std::to_string(i));
  require((f.scale_y < 0)==reflection,"Reflection sign");
}
static void rejected(Matrix m, const std::string &code) {
  bool passed=false;
  try { affine_factors(m); }
  catch (const std::runtime_error &error) { passed=std::string(error.what()).starts_with(code); }
  require(passed,code);
}
int main() {
  try {
    for (const auto &m : std::vector<Matrix>{matrix(1,0,0,1),matrix(-1,0,0,1),
      matrix(0,1,-1,0),matrix(2,0,0,-3,29,-17),matrix(1,0,0.7,1),
      matrix(1,-0.8,0.6,1),matrix(0,-3,2,0)})
      reconstruct(m, m[0]*m[5]-m[1]*m[4]<0);
    reconstruct(matrix(1e200,0,0,2e200), false);
    reconstruct(matrix(1e-200,0,0,-2e-200), true);
    // Deterministic matrices, independently sampled rather than generated from
    // the factors under test. Negative determinants occur throughout this set.
    uint32_t state=0x462702ab;
    auto sample=[&]() { state^=state<<13;state^=state>>17;state^=state<<5;
      return (int(state%20001)-10000)/1000.0; };
    for(int i=0;i<4096;++i) {
      auto m=matrix(sample(),sample(),sample(),sample(),sample(),sample());
      if(std::abs(m[0]*m[5]-m[1]*m[4])<1e-4)continue;
      reconstruct(m,m[0]*m[5]-m[1]*m[4]<0);
    }
    rejected(matrix(0,0,0,0),"E_TRANSFORM_SINGULAR");
    rejected(matrix(1,2,2,4),"E_TRANSFORM_SINGULAR");
    // Normalizing proportional columns must not create a synthetic nonzero
    // singular value through rounding of their cross products.
    for(int a=1;a<40;++a)for(int b=1;b<40;++b)for(int k=2;k<10;++k)
      rejected(matrix(a,b,a*k,b*k),"E_TRANSFORM_SINGULAR");
    for (int i : {2,3,6,7,8,9,10,11,14,15}) {
      auto m=matrix(1,0,0,1);m[i]=2;rejected(m,"E_TRANSFORM_3D");
    }
    for(int i=0;i<16;++i) {
      auto m=matrix(1,0,0,1);m[i]=std::numeric_limits<double>::infinity();
      rejected(m,"E_TRANSFORM_NONFINITE");
    }
    auto m=matrix(1,0,0,1);m[0]=std::numeric_limits<double>::quiet_NaN();
    rejected(m,"E_TRANSFORM_NONFINITE");
    std::cout<<"{\"passed\":true,\"checks\":"<<checks<<"}\n";
  } catch(const std::exception &error) {
    std::cerr<<error.what()<<"\n";return 1;
  }
}
