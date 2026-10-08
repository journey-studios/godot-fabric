import React, {useRef, useState} from "react";
import {AppRegistry, Modal, Pressable, ScrollView, Text, View} from "react-native";

function ModalWheelProbe() {
  const [clicks, setClicks] = useState(0);
  const [modalVisible, setModalVisible] = useState(true);
  const modalVerticalRef = useRef(null);
  const modalHorizontalRef = useRef(null);
  globalThis.ModalWheelProbe = {snapshot: () => ({clicks}), setVisible: setModalVisible,
    resetModalOffsets: () => {
      modalVerticalRef.current?.scrollTo({x: 0, y: 0, animated: false});
      modalHorizontalRef.current?.scrollTo({x: 0, y: 0, animated: false});
    }};
  const scrollStyle = {position: "absolute", width: 190, height: 130};
  const content = name => <View testID={`probe-${name}-content`} style={{width: 640, height: 640, backgroundColor: "#203040"}}>
    <Pressable testID={`probe-${name}-action`} onPress={() => setClicks(value => value + 1)}
      style={{width: 100, height: 44, backgroundColor: "#5680aa"}}><Text>Action</Text></Pressable>
  </View>;
  return <View testID="probe-root" style={{width: 640, height: 480}}>
    <ScrollView testID="probe-root-vertical" style={{...scrollStyle, left: 10, top: 10}}
      contentContainerStyle={{minWidth: 640, minHeight: 640}}>{content("root-vertical")}</ScrollView>
    <ScrollView horizontal testID="probe-root-horizontal" style={{...scrollStyle, left: 210, top: 10}}
      contentContainerStyle={{minWidth: 640, minHeight: 640}}>{content("root-horizontal")}</ScrollView>
    <Modal testID="probe-modal" visible={modalVisible} transparent presentationStyle="overFullScreen">
      <View testID="probe-modal-content" style={{flex: 1, width: 640, height: 480}}>
        <ScrollView ref={modalVerticalRef} testID="probe-modal-vertical" style={{...scrollStyle, left: 20, top: 20}}
          contentContainerStyle={{minWidth: 640, minHeight: 640}}>{content("modal-vertical")}</ScrollView>
        <ScrollView ref={modalHorizontalRef} horizontal testID="probe-modal-horizontal" style={{...scrollStyle, left: 230, top: 20}}
          contentContainerStyle={{minWidth: 640, minHeight: 640}}>{content("modal-horizontal")}</ScrollView>
      </View>
    </Modal>
    <Text testID="probe-click-count">{clicks}</Text>
  </View>;
}

AppRegistry.registerComponent("ModalWheelProbe", () => ModalWheelProbe);
