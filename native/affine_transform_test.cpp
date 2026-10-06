#include "affine_transform.h"
#include <iostream>
#include <limits>
#include <string>
#include <vector>

using fabric_godot::affine_factors;
using fabric_godot::planar_violation;
using fabric_godot::PlanarViolation;
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
static bool same_factors(const fabric_godot::AffineFactors &a, const fabric_godot::AffineFactors &b) {
  return a.rotation==b.rotation && a.scale_x==b.scale_x && a.scale_y==b.scale_y &&
    a.offset_rotation==b.offset_rotation && a.translate_x==b.translate_x && a.translate_y==b.translate_y;
}
static Matrix with_z(Matrix m, double z) { m[10]=z; return m; }
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
    // The z-coupling entries and the weight keep a transform out of the plane, each
    // with its own message of E_TRANSFORM_3D; z-coupling is reported first.
    for (int i : {2,3,6,7,8,9,11,14}) {
      auto m=matrix(1,0,0,1);m[i]=2;rejected(m,"E_TRANSFORM_3D: perspective and 3D transforms are not implemented");
    }
    {
      auto m=matrix(1,0,0,1);m[15]=2;
      rejected(m,"E_TRANSFORM_3D: expected a planar affine transform");
      m[11]=1;
      rejected(m,"E_TRANSFORM_3D: perspective and 3D transforms are not implemented");
    }
    // The one definition of "planar", which pointer projection shares with the
    // transform adapter: zero in every z-coupling entry and a weight of 1, whatever m[10] holds.
    require(planar_violation(matrix(1,0,0,1))==PlanarViolation::None,"Identity is planar");
    for (int i : {2,3,6,7,8,9,11,14}) {
      auto m=matrix(1,0,0,1);m[i]=0.5;
      require(planar_violation(m)==PlanarViolation::ZCoupling,"Entry "+std::to_string(i)+" couples z");
    }
    {
      auto m=matrix(1,0,0,1);m[15]=2;
      require(planar_violation(m)==PlanarViolation::Weight,"A weight other than 1 is not planar");
      m[11]=1;
      require(planar_violation(m)==PlanarViolation::ZCoupling,"Z coupling is reported before the weight");
    }
    for (double z : {0.0,0.25,1.0,-2.0,1e30,1e-30})
      require(planar_violation(with_z(matrix(2,0,0,2),z))==PlanarViolation::None,"m[10] is free: "+std::to_string(z));
    // RN's own matrix is Float: the same rule on std::array<float, 16>.
    const std::array<float,16> rn_scale{1.5f,0,0,0,0,1.5f,0,0,0,0,1.5f,0,0,0,0,1};
    require(planar_violation(rn_scale)==PlanarViolation::None,"RN's Float scale3d(1.5, 1.5, 1.5) is planar");
    std::array<float,16> rn_perspective=rn_scale;
    rn_perspective[11]=-1.0f/300;
    require(planar_violation(rn_perspective)==PlanarViolation::ZCoupling,"RN's Float perspective(300) is not planar");
    // RN writes `scale: n` as scale3d(n, n, n), so n also sits at index 10. With
    // every z-coupling entry zero it only multiplies z and cannot move a point of
    // the plane: the planar factors are those of the same matrix with m[10] = 1.
    for (double n : {0.001,0.5,1.5,2.0,3.0,100.0}) {
      const auto uniform=with_z(matrix(n,0,0,n),n);
      const auto f=affine_factors(uniform);
      require(f.scale_x==n && f.scale_y==n && f.rotation==0 && f.offset_rotation==0 &&
        f.translate_x==0 && f.translate_y==0, "Uniform scale factors: "+std::to_string(n));
      reconstruct(uniform,false);
      for (double z : {0.0,0.25,1.0,-2.0,1e30,1e-30})
        require(same_factors(f,affine_factors(with_z(matrix(n,0,0,n),z))),
          "m[10] never changes the planar factors: "+std::to_string(z));
      // A uniform scale composed with a rotation and an origin translation, as
      // RN builds [{scale}, {rotate}] around a transformOrigin.
      for (double degrees : {-170.0,-30.0,30.0,90.0,135.0}) {
        const auto angle=degrees*M_PI/180, c=n*std::cos(angle), s=n*std::sin(angle);
        const auto similarity=with_z(matrix(c,s,-s,c,20,-12.5),n);
        const auto g=affine_factors(similarity);
        reconstruct(similarity,false);
        require(std::abs(g.scale_x-n)<=n*1e-12 && std::abs(g.scale_y-n)<=n*1e-12 &&
          std::abs(std::remainder(g.rotation+g.offset_rotation-angle,2*M_PI))<=1e-12 &&
          g.translate_x==20 && g.translate_y==-12.5, "Uniform scale with rotation factors: "+std::to_string(degrees));
      }
    }
    // scale: 0 is singular in the plane; with m[10] unchecked it reports that
    // instead of the nonplanar error it used to hit first.
    rejected(with_z(matrix(0,0,0,0),0),"E_TRANSFORM_SINGULAR");
    for(int i=0;i<16;++i) {
      auto m=matrix(1,0,0,1);m[i]=std::numeric_limits<double>::infinity();
      rejected(m,"E_TRANSFORM_NONFINITE");
    }
    for (int i : {0,10,15}) {
      auto m=matrix(1,0,0,1);m[i]=std::numeric_limits<double>::quiet_NaN();
      rejected(m,"E_TRANSFORM_NONFINITE");
    }
    std::cout<<"{\"passed\":true,\"checks\":"<<checks<<"}\n";
  } catch(const std::exception &error) {
    std::cerr<<error.what()<<"\n";return 1;
  }
}
