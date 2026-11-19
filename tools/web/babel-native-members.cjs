const members = require('babel-plugin-react-native-web/src/moduleMap');

// SWC's lazy CommonJS namespace imports bypass Expo's named-import optimization.
// shortcut: only this exact helper shape is optimized; other shapes keep the original module.
module.exports = ({ types: t }) => ({
  name: 'aquora-web-native-members',
  visitor: {
    Program(program) {
      program.traverse({
        FunctionDeclaration(fn) {
          const { id, params, body } = fn.node;
          if (!id || params.length || body.body.length !== 3) return;
          const [declaration, assignment, result] = body.body;
          if (!t.isVariableDeclaration(declaration) || declaration.declarations.length !== 1)
            return;
          const { id: local, init } = declaration.declarations[0];
          if (
            !t.isIdentifier(local) ||
            !t.isCallExpression(init) ||
            !t.isIdentifier(init.callee, { name: 'require' }) ||
            init.arguments.length !== 1 ||
            !t.isStringLiteral(init.arguments[0], { value: 'react-native' }) ||
            fn.scope.getBinding('require')
          )
            return;
          if (
            !t.isExpressionStatement(assignment) ||
            !t.isAssignmentExpression(assignment.expression, { operator: '=' }) ||
            !t.isIdentifier(assignment.expression.left, { name: id.name }) ||
            !t.isFunctionExpression(assignment.expression.right) ||
            assignment.expression.right.params.length ||
            assignment.expression.right.body.body.length !== 1 ||
            !t.isReturnStatement(assignment.expression.right.body.body[0]) ||
            !t.isIdentifier(assignment.expression.right.body.body[0].argument, {
              name: local.name,
            }) ||
            !t.isReturnStatement(result) ||
            !t.isIdentifier(result.argument, { name: local.name })
          )
            return;
          const binding = fn.scope.parent.getBinding(id.name);
          if (
            !binding ||
            binding.constantViolations.length !== 1 ||
            binding.constantViolations[0].node !== assignment.expression ||
            !binding.referencePaths.length
          )
            return;
          const used = new Set();
          const platforms = [];
          for (const ref of binding.referencePaths) {
            const call = ref.parentPath;
            const member = call.parentPath;
            if (
              !call.isCallExpression() ||
              call.node.callee !== ref.node ||
              call.node.arguments.length ||
              !member.isMemberExpression() ||
              member.node.object !== call.node ||
              member.node.computed ||
              !t.isIdentifier(member.node.property) ||
              !members[member.node.property.name] ||
              member.parentPath.isAssignmentExpression() ||
              member.parentPath.isUpdateExpression() ||
              member.parentPath.isUnaryExpression({ operator: 'delete' })
            )
              return;
            used.add(member.node.property.name);
            const os = member.parentPath;
            if (
              member.node.property.name === 'Platform' &&
              os.isMemberExpression() &&
              !os.node.computed &&
              t.isIdentifier(os.node.property, { name: 'OS' }) &&
              !(os.parentPath.isAssignmentExpression() && os.parentPath.node.left === os.node) &&
              !os.parentPath.isUpdateExpression() &&
              !os.parentPath.isUnaryExpression({ operator: 'delete' })
            )
              platforms.push(os);
          }
          // This plugin only runs for web; make platform checks visible to Expo's dead-code removal.
          for (const os of platforms) os.replaceWith(t.stringLiteral('web'));
          declaration.declarations[0].init = t.objectExpression(
            [...used].map((name) =>
              t.objectMethod(
                'get',
                t.identifier(name),
                [],
                t.blockStatement([
                  t.returnStatement(
                    t.memberExpression(
                      t.callExpression(t.identifier('require'), [
                        t.stringLiteral(`react-native-web/dist/exports/${name}`),
                      ]),
                      t.identifier('default'),
                    ),
                  ),
                ]),
              ),
            ),
          );
        },
      });
    },
  },
});
